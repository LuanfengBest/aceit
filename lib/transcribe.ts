import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** whisper.cpp 只吃 16kHz 单声道 wav，所以先过一道 ffmpeg */
const WHISPER = "whisper-cli";
const MODEL = path.join(process.cwd(), "data", "models", "ggml-medium.bin");

export interface TranscribeOptions {
  /** 只转前多少秒，不填就全转 */
  limitSeconds?: number;
  language?: string;
}

/**
 * 音视频转文字。本地跑，不上传任何东西。
 * 一小时的面试录音在 M 系列芯片上大约要几分钟。
 */
export async function transcribe(
  inputPath: string,
  options: TranscribeOptions = {}
): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "aceit-stt-"));
  const wav = path.join(dir, "audio.wav");
  const out = path.join(dir, "out");

  try {
    const ffmpegArgs = ["-v", "error", "-i", inputPath];
    if (options.limitSeconds) ffmpegArgs.push("-t", String(options.limitSeconds));
    ffmpegArgs.push("-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav, "-y");
    await run("ffmpeg", ffmpegArgs, { maxBuffer: 1024 * 1024 * 32 });

    await run(
      WHISPER,
      [
        "-m", MODEL,
        "-f", wav,
        "-l", options.language ?? "zh",
        "-otxt",
        "-of", out,
        "--no-prints",
        // 面经和面试都是长句，加大上下文有助于断句
        "-bs", "5",
      ],
      { maxBuffer: 1024 * 1024 * 64, timeout: 30 * 60 * 1000 }
    );

    const text = await readFile(`${out}.txt`, "utf8");
    return stripHallucinations(text);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * whisper 在静音段会稳定吐出一些固定的字幕组水印。
 * 这些是模型幻觉，不是音频内容，必须滤掉否则会污染后面的消化。
 */
const HALLUCINATIONS = [
  /请不吝点赞[^\n]*/g,
  /订阅[ 、]?转发[ 、]?打赏[^\n]*/g,
  /整理\s*&?\s*字幕[:：][^\n]*/g,
  /明镜与点点栏目/g,
  /字幕由.*提供/g,
  /本字幕由[^\n]*/g,
  /Amara\.org/gi,
  /^\s*(谢谢观看|感谢观看|下期再见)\s*$/gm,
];

function stripHallucinations(text: string): string {
  let out = text;
  for (const re of HALLUCINATIONS) out = out.replace(re, "");
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}
