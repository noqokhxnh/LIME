import { Queue } from "bullmq";
import IORedis from "ioredis";
import { v4 } from "uuid";
import { getConfig } from "./config.js";
import { jobsStore, redisClient, type JobRecord } from "./jobsStore.js";
import { videoRequestSchema } from "./llm/schema.js";

async function main() {
    const args = process.argv.slice(2);
    
    let prompt = "";
    const promptIndex = args.indexOf("--prompt");
    if (promptIndex !== -1 && args[promptIndex + 1]) {
        prompt = args[promptIndex + 1];
    } else {
        // Fallback to the first argument if --prompt is not specified
        prompt = args.join(" ");
    }
    
    if (!prompt.trim()) {
        console.error("Lỗi: Bạn chưa cung cấp nội dung (prompt) cho video.");
        console.error("Sử dụng: npm run cli -- --prompt \"<Ý tưởng video của bạn>\"");
        process.exit(1);
    }
    
    console.log(`[CLI] Đang khởi tạo Job tạo video cho yêu cầu: "${prompt}"...`);
    
    const config = getConfig();
    const connection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });
    const videoQueue = new Queue("video-generation", { connection });
    
    const jobId = v4();
    const rawReq = {
        promt: prompt,
        aspectRatio: "16:9",
        targetDurationSec: 30,
        language: "vi",
        style: "modern"
    };

    // Validate thông qua schema
    const reqData = videoRequestSchema.parse(rawReq);

    const job: JobRecord = {
        jobId,
        status: 'queued',
        request: reqData,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    
    await jobsStore.set(jobId, job);
    await videoQueue.add("render", { script: undefined }, { jobId });
    
    console.log(`[CLI] ✅ Đã đưa Job vào hàng đợi thành công! Job ID: ${jobId}`);
    console.log(`[CLI] Hãy chắc chắn worker đang chạy (npm run worker).`);
    console.log(`[CLI] Xem trạng thái: http://localhost:${config.PORT}/api/jobs/${jobId}`);
    
    // Đóng kết nối Redis để kết thúc process CLI
    await connection.quit();
    await redisClient.quit();
}

main().catch(err => {
    console.error("[CLI] Có lỗi xảy ra:", err);
    process.exit(1);
});
