// 디자인 토큰 미리보기 페이지. 실행: npm run tokens:preview
// 페이지의 "tokens.ts에 저장" 버튼이 이 개발 서버에 값을 보내면 utils/ui/tokens.ts를 다시 쓴다.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';
import { defineConfig, type Plugin } from 'vite';
import type { TokenSet } from '../../utils/ui/tokens';
import { replaceTokenBlock, validateTokenSet } from './save';

const root = fileURLToPath(new URL('.', import.meta.url));
const tokensPath = fileURLToPath(new URL('../../utils/ui/tokens.ts', import.meta.url));
const MAX_BODY = 64 * 1024;

function saveTokens(): Plugin {
  return {
    name: 'khp-save-tokens',
    configureServer(server) {
      server.middlewares.use('/__tokens/save', (req, res) => {
        const reply = (status: number, message: string) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ ok: status === 200, message }));
        };
        if (req.method !== 'POST') return reply(405, 'POST만 받습니다');
        // 다른 사이트가 이 주소로 값을 보내지 못하게 같은 개발 서버에서 온 요청만 받는다.
        const host = req.headers.host ?? '';
        if (req.headers.origin !== `http://${host}`) return reply(403, '다른 출처의 요청입니다');

        let body = '';
        req.setEncoding('utf8');
        req.on('data', (chunk: string) => {
          body += chunk;
          if (body.length > MAX_BODY) req.destroy();
        });
        req.on('end', () => {
          void (async () => {
            try {
              const mod = (await server.ssrLoadModule(tokensPath)) as { tokens: TokenSet };
              const next = validateTokenSet(JSON.parse(body), mod.tokens);
              const source = await readFile(tokensPath, 'utf8');
              const options = (await prettier.resolveConfig(tokensPath)) ?? {};
              const formatted = await prettier.format(replaceTokenBlock(source, next), {
                ...options,
                filepath: tokensPath,
              });
              await writeFile(tokensPath, formatted, 'utf8');
              reply(200, 'utils/ui/tokens.ts에 저장했습니다');
            } catch (error) {
              reply(400, error instanceof Error ? error.message : String(error));
            }
          })();
        });
      });
    },
  };
}

export default defineConfig({
  root,
  plugins: [saveTokens()],
  server: { host: '127.0.0.1', open: true },
});
