import http from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

export const ALLOWED_CONTAINERS = [
    'lime_server',
    'lime_worker',
    'lime_postgres',
    'lime_redis',
    'lime_vieneu_tts',
] as const;

export type AllowedContainer = (typeof ALLOWED_CONTAINERS)[number];

export interface ContainerInfo {
    name: AllowedContainer;
    label: string;
    description: string;
    running: boolean;
    status: string;
    id?: string;
    image?: string;
    created?: string;
}

export const CONTAINER_METADATA: Record<AllowedContainer, { label: string; description: string }> = {
    lime_server: {
        label: 'Fastify API Server',
        description: 'REST API, SSE streaming, xác thực người dùng và phục vụ giao diện Web Studio/Admin',
    },
    lime_worker: {
        label: 'Video & Billing Worker',
        description: 'Hàng đợi BullMQ xử lý pipeline tạo video, Playwright/ffmpeg render và webhook thanh toán',
    },
    lime_postgres: {
        label: 'PostgreSQL Database',
        description: 'Lưu trữ tài khoản, phiên đăng nhập, đơn hàng, cấu hình hệ thống và audit logs',
    },
    lime_redis: {
        label: 'Redis Cache & Queue',
        description: 'Hàng đợi video-generation, sepay-webhooks, pub/sub tiến độ render và rate limit',
    },
    lime_vieneu_tts: {
        label: 'VieNeu-TTS Service',
        description: 'Microservice tổng hợp giọng đọc tiếng Việt nơ-ron chất lượng cao (port 7860)',
    },
};

const DOCKER_SOCKET = '/var/run/docker.sock';

export function isAllowedContainer(name: string): name is AllowedContainer {
    return (ALLOWED_CONTAINERS as readonly string[]).includes(name);
}

/**
 * Gửi yêu cầu HTTP đến Docker Engine API qua unix socket /var/run/docker.sock.
 */
function requestDockerSocket(path: string): Promise<any> {
    return new Promise((resolve, reject) => {
        if (!existsSync(DOCKER_SOCKET)) {
            return reject(new Error('Docker socket không tồn tại tại ' + DOCKER_SOCKET));
        }

        const req = http.request(
            {
                socketPath: DOCKER_SOCKET,
                path,
                method: 'GET',
                timeout: 5000,
            },
            (res) => {
                let data = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => (data += chunk));
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            resolve(JSON.parse(data));
                        } catch {
                            resolve(data);
                        }
                    } else {
                        reject(new Error(`Docker API trả về mã lỗi ${res.statusCode}: ${data}`));
                    }
                });
            }
        );

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Yêu cầu tới Docker socket bị quá thời gian (timeout)'));
        });
        req.end();
    });
}

/**
 * Lấy danh sách và trạng thái hiện tại của 5 container LIME.
 */
export async function getContainersStatus(): Promise<ContainerInfo[]> {
    const results: ContainerInfo[] = [];

    // Thử truy vấn chi tiết qua Docker socket trước
    let dockerInspectMap: Record<string, any> = {};
    if (existsSync(DOCKER_SOCKET)) {
        try {
            const containers = await requestDockerSocket('/containers/json?all=1');
            if (Array.isArray(containers)) {
                for (const c of containers) {
                    const names = (c.Names || []).map((n: string) => n.replace(/^\//, ''));
                    for (const n of names) {
                        dockerInspectMap[n] = c;
                    }
                }
            }
        } catch (err) {
            // Không ngắt nếu lỗi, sẽ thử inspect qua CLI hoặc đánh dấu mặc định
        }
    }

    for (const name of ALLOWED_CONTAINERS) {
        const meta = CONTAINER_METADATA[name];
        const raw = dockerInspectMap[name];

        if (raw) {
            const isUp = typeof raw.State === 'string' ? raw.State === 'running' : raw.Status?.toLowerCase().includes('up');
            results.push({
                name,
                label: meta.label,
                description: meta.description,
                running: Boolean(isUp),
                status: raw.Status || (isUp ? 'Đang chạy' : 'Đã dừng'),
                id: (raw.Id || '').slice(0, 12),
                image: raw.Image || '',
                created: raw.Created ? new Date(raw.Created * 1000).toISOString() : undefined,
            });
        } else {
            // Kiểm tra trạng thái bằng CLI nếu socket không có thông tin
            const cliInfo = await checkContainerWithCli(name);
            results.push({
                name,
                label: meta.label,
                description: meta.description,
                running: cliInfo.running,
                status: cliInfo.status,
                id: cliInfo.id,
                image: cliInfo.image,
            });
        }
    }

    return results;
}

function checkContainerWithCli(container: string): Promise<{ running: boolean; status: string; id?: string; image?: string }> {
    return new Promise((resolve) => {
        const child = spawn('docker', ['inspect', '--format', '{{.State.Running}}|{{.State.Status}}|{{.Id}}|{{.Config.Image}}', container]);
        let stdout = '';
        child.stdout.on('data', (d) => (stdout += d.toString()));
        child.on('error', () => resolve({ running: false, status: 'Không khả dụng' }));
        child.on('close', (code) => {
            if (code === 0 && stdout.trim()) {
                const parts = stdout.trim().split('|');
                const running = parts[0] === 'true';
                const status = parts[1] || (running ? 'running' : 'stopped');
                const id = (parts[2] || '').slice(0, 12);
                const image = parts[3] || '';
                resolve({ running, status, id, image });
            } else {
                resolve({ running: false, status: 'Không tìm thấy container' });
            }
        });
    });
}

export interface StreamLogCallbacks {
    onData: (text: string, streamType: 'stdout' | 'stderr') => void;
    onError: (err: Error) => void;
    onEnd: () => void;
}

export interface StreamLogHandle {
    abort: () => void;
}

/**
 * Stream trực tiếp log của một container (tương đương docker logs -f <container>).
 * Tự động thử qua Docker Socket trước, nếu không khả dụng sẽ fallback sang `docker` CLI.
 */
export function streamDockerLogs(
    container: AllowedContainer,
    options: {
        tail?: number;
        follow?: boolean;
    },
    callbacks: StreamLogCallbacks
): StreamLogHandle {
    const tail = Math.min(Math.max(options.tail ?? 100, 1), 2000);
    const follow = options.follow !== false;

    // Ưu tiên 1: Kết nối qua Docker Unix Socket
    if (existsSync(DOCKER_SOCKET)) {
        try {
            return streamViaSocket(container, tail, follow, callbacks);
        } catch (err) {
            // Socket lỗi thì rơi xuống CLI
        }
    }

    // Ưu tiên 2: Fallback sang Docker CLI spawn
    return streamViaCli(container, tail, follow, callbacks);
}

/**
 * Đọc log qua Docker Unix Socket HTTP API và demux 8-byte frame header
 */
function streamViaSocket(
    container: AllowedContainer,
    tail: number,
    follow: boolean,
    callbacks: StreamLogCallbacks
): StreamLogHandle {
    let aborted = false;
    const path = `/containers/${container}/logs?stdout=1&stderr=1&timestamps=1&tail=${tail}&follow=${follow ? 1 : 0}`;

    const req = http.request(
        {
            socketPath: DOCKER_SOCKET,
            path,
            method: 'GET',
        },
        (res) => {
            if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
                let errBody = '';
                res.on('data', (c) => (errBody += c));
                res.on('end', () => {
                    callbacks.onError(new Error(`Docker Socket trả về mã ${res.statusCode}: ${errBody}`));
                });
                return;
            }

            let acc = Buffer.alloc(0);

            res.on('data', (chunk: Buffer) => {
                if (aborted) return;
                acc = Buffer.concat([acc, chunk]);

                // Docker multiplex protocol header: 8 bytes
                // byte 0: stream type (1=stdout, 2=stderr)
                // bytes 1-3: zeros
                // bytes 4-7: uint32be length
                while (acc.length >= 8) {
                    const streamCode = acc[0];
                    const streamType = streamCode === 2 ? 'stderr' : 'stdout';
                    const length = acc.readUInt32BE(4);

                    if (acc.length < 8 + length) {
                        // Chưa đủ frame, chờ chunk kế tiếp
                        break;
                    }

                    const payload = acc.subarray(8, 8 + length).toString('utf8');
                    acc = acc.subarray(8 + length);

                    callbacks.onData(payload, streamType);
                }
            });

            res.on('end', () => {
                if (!aborted) callbacks.onEnd();
            });

            res.on('error', (err) => {
                if (!aborted) callbacks.onError(err);
            });
        }
    );

    req.on('error', (err) => {
        if (!aborted) {
            // Thử fallback CLI nếu socket request gặp lỗi cấp kết nối
            const cliHandle = streamViaCli(container, tail, follow, callbacks);
            return cliHandle;
        }
    });

    req.end();

    return {
        abort: () => {
            aborted = true;
            try {
                req.destroy();
            } catch {}
        },
    };
}

/**
 * Đọc log qua child_process.spawn('docker', ['logs', ...])
 */
function streamViaCli(
    container: AllowedContainer,
    tail: number,
    follow: boolean,
    callbacks: StreamLogCallbacks
): StreamLogHandle {
    let aborted = false;
    const args = ['logs', '-t', '--tail', String(tail)];
    if (follow) args.push('-f');
    args.push(container);

    const child = spawn('docker', args);

    child.stdout.on('data', (data) => {
        if (!aborted) callbacks.onData(data.toString('utf8'), 'stdout');
    });

    child.stderr.on('data', (data) => {
        if (!aborted) callbacks.onData(data.toString('utf8'), 'stderr');
    });

    child.on('error', (err) => {
        if (!aborted) {
            callbacks.onError(new Error(`Không thể khởi chạy lệnh docker: ${err.message}`));
        }
    });

    child.on('close', (code) => {
        if (!aborted) {
            if (code !== 0 && code !== null) {
                callbacks.onError(new Error(`Tiến trình docker logs kết thúc với mã lỗi ${code}`));
            } else {
                callbacks.onEnd();
            }
        }
    });

    return {
        abort: () => {
            aborted = true;
            try {
                child.kill('SIGTERM');
            } catch {}
        },
    };
}

/**
 * Tải toàn bộ log dưới dạng một chuỗi văn bản (dùng cho tải file .txt).
 */
export function getDockerLogsSnapshot(container: AllowedContainer, tail: number = 1000): Promise<string> {
    return new Promise((resolve, reject) => {
        let output = '';
        const handle = streamDockerLogs(
            container,
            { tail, follow: false },
            {
                onData: (text) => (output += text),
                onError: (err) => reject(err),
                onEnd: () => resolve(output),
            }
        );

        // Timeout an toàn 15 giây
        setTimeout(() => {
            handle.abort();
            resolve(output || `(Không nhận được phản hồi log sau 15 giây)`);
        }, 15000);
    });
}
