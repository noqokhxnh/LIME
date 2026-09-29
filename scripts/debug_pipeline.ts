import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderVideo } from "../src/pipeline/renderer.js";
import { assembleHtml } from "../src/pipeline/assembleHtml.js";
import { generateSilence } from "../src/pipeline/audioSysnthesis.js";
import { videoScriptSchema } from "../src/llm/schema.js";

async function main() {
    const args = process.argv.slice(2);
    
    if (args.includes('--html')) {
        const htmlPath = resolve(args[args.indexOf('--html') + 1]);
        console.log(`Running pipeline directly with HTML: ${htmlPath}`);
        
        await renderVideo({
            htmlPath,
            audioPath: "dummy.mp3",
            outputPath: "test_render.mp4",
            width: 1920,
            height: 1080,
            durationSec: 10,
            fps: 30,
            onProgress: (msg, pct) => console.log(`[${pct ?? 0}%] ${msg}`)
        });
        
        console.log("Render completed: test_render.mp4");
        return;
    }
    
    if (args.includes('--script') && args.includes('--mock-audio')) {
        const scriptPath = resolve(args[args.indexOf('--script') + 1]);
        console.log(`Running pipeline with JSON Script: ${scriptPath} and mocked audio`);
        
        const content = readFileSync(scriptPath, "utf-8");
        const script = videoScriptSchema.parse(JSON.parse(content));
        
        const workDir = resolve("tmp", "debug-job");
        mkdirSync(workDir, { recursive: true });
        
        const durations: Record<string, number> = {};
        for (const s of script.scenes) {
            durations[s.id] = 3.0; // Mock 3s per scene
        }
        
        console.log("Assembling HTML...");
        const html = await assembleHtml(script, durations);
        const htmlPath = resolve(workDir, "index.html");
        writeFileSync(htmlPath, html, "utf-8");
        
        const totalDuration = Object.values(durations).reduce((a, b) => a + b, 0);
        const audioPath = resolve(workDir, "mock_audio.mp3");
        console.log(`Generating silence audio (${totalDuration}s)...`);
        await generateSilence(audioPath, totalDuration);
        
        console.log("Rendering Video...");
        await renderVideo({
            htmlPath,
            audioPath,
            outputPath: "test_render.mp4",
            width: 1920,
            height: 1080,
            durationSec: totalDuration,
            fps: 30,
            onProgress: (msg, pct) => console.log(`[${pct ?? 0}%] ${msg}`)
        });
        
        console.log("Render completed: test_render.mp4");
        return;
    }
    
    console.log("Usage:");
    console.log("  npx tsx scripts/debug_pipeline.ts --html <path.html>");
    console.log("  npx tsx scripts/debug_pipeline.ts --script <path.json> --mock-audio");
}

main().catch(err => {
    console.error("Debug Replay Error:", err);
    process.exit(1);
});
