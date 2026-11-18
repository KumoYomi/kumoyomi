export interface MihonConvertResult {
  ok: boolean;
  reason?: string;
  dir?: string;
  config?: {
    id: string;
    name: string;
    lang: string;
    extends: string;
    baseUrl: string;
    nsfw?: boolean;
    vars?: Record<string, string>;
  };
}

export function convertKeiyoushiDirectory(extDir: string): MihonConvertResult;
