import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";

export const ACCEPTED_EXTENSIONS = [".md", ".txt", ".pdf", ".docx"] as const;

export class UnsupportedFileError extends Error {}

// mammoth 运行时有 convertToMarkdown，但它自带的 .d.ts 漏了这个导出
type MammothMarkdown = {
  convertToMarkdown: (input: { buffer: Buffer }) => Promise<{ value: string }>;
};

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot).toLowerCase();
}

/** mammoth 会把正文里的 # * _ 等转义成 \# \* \_，标题行本身不受影响，这里还原掉 */
function unescapeMarkdown(md: string): string {
  return md.replace(/\\([\\`*_{}[\]()#+\-.!>])/g, "$1");
}

/**
 * mammoth 会把 docx 里的内嵌图片转成 base64 data URI 塞进正文。
 * 一张截图就是几十万字符——不去掉的话正文会被图片淹没，切块全是乱码。
 */
function stripInlineImages(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\(data:[^)]*\)/g, "")
    .replace(/<img[^>]*>/gi, "");
}

/**
 * 解析成纯文本。docx 走 markdown 转换以**保留标题层级**——
 * 标题是后面切块的依据，用 extractRawText 会把结构全丢掉。
 */
export async function parseDocument(
  filename: string,
  bytes: ArrayBuffer
): Promise<string> {
  const ext = extensionOf(filename);

  switch (ext) {
    case ".md":
    case ".txt":
      return new TextDecoder().decode(bytes).trim();

    case ".docx": {
      const result = await (
        mammoth as unknown as MammothMarkdown
      ).convertToMarkdown({ buffer: Buffer.from(bytes) });
      return unescapeMarkdown(stripInlineImages(result.value)).trim();
    }

    case ".pdf": {
      // PDF 没有标题样式，拿到的天生是无结构纯文本
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const { text } = await extractText(pdf, { mergePages: true });
      return text.trim();
    }

    default:
      throw new UnsupportedFileError(
        `不支持的文件类型 ${ext || "(无扩展名)"}，只接受 ${ACCEPTED_EXTENSIONS.join(" / ")}`
      );
  }
}
