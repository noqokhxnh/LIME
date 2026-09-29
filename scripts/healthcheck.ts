import { spawnSync } from "node:child_process";
import { mkdirSync, accessSync, constants } from "node:fs";
import { resolve } from "node:path";

function checkBinary(name: string, args: string[]) {
    try {
        const result = spawnSync(name, args, { stdio: "ignore" });
        if (result.error || result.status !== 0) {
            return false;
        }
        return true;
    } catch {
        return false;
    }
}

function main() {
    console.log("Checking Environment Health...");
    let allGood = true;

    if (checkBinary("ffmpeg", ["-version"])) {
        console.log("✅ FFmpeg is installed.");
    } else {
        console.error("❌ FFmpeg is missing or not executable.");
        allGood = false;
    }

    if (checkBinary("ffprobe", ["-version"])) {
        console.log("✅ FFprobe is installed.");
    } else {
        console.error("❌ FFprobe is missing or not executable.");
        allGood = false;
    }

    const tmpDir = resolve(process.cwd(), "tmp");
    try {
        mkdirSync(tmpDir, { recursive: true });
        accessSync(tmpDir, constants.W_OK | constants.R_OK);
        console.log("✅ tmp/ directory is writable.");
    } catch (e: any) {
        console.error(`❌ tmp/ directory is not writable: ${e.message}`);
        allGood = false;
    }

    if (!allGood) {
        console.error("\nHealthcheck FAILED. Please fix the above issues.");
        process.exit(1);
    } else {
        console.log("\nHealthcheck PASSED. Environment is ready.");
    }
}

main();
