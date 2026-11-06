// 미리보기 페이지에서 고친 토큰을 utils/ui/tokens.ts에 다시 쓰는 부분.
import type { TokenSet } from '../../utils/ui/tokens';

export const BLOCK_START = '// tokens:start';
export const BLOCK_END = '// tokens:end';

/**
 * 받은 값이 지금 토큰과 같은 묶음, 같은 이름, 같은 값 종류인지 확인한다.
 * 이름을 더하거나 지우는 일은 tokens.ts를 직접 고쳐서 한다.
 */
export function validateTokenSet(input: unknown, current: TokenSet): TokenSet {
  if (typeof input !== 'object' || input === null) throw new Error('토큰 값이 객체가 아닙니다');
  const record = input as Record<string, unknown>;
  for (const group of Object.keys(current) as (keyof TokenSet)[]) {
    const next = record[group];
    if (typeof next !== 'object' || next === null) throw new Error(`${group} 묶음이 없습니다`);
    const nextGroup = next as Record<string, unknown>;
    const expected = Object.keys(current[group]).sort().join(',');
    const actual = Object.keys(nextGroup).sort().join(',');
    if (expected !== actual) throw new Error(`${group} 묶음의 이름이 바뀌었습니다`);
    for (const [key, value] of Object.entries(current[group])) {
      const got = nextGroup[key];
      if (typeof got !== typeof value) throw new Error(`${group}.${key}의 값 종류가 다릅니다`);
      if (typeof got === 'number' && !Number.isFinite(got)) {
        throw new Error(`${group}.${key}가 숫자가 아닙니다`);
      }
      if (group === 'color' && !/^#[0-9a-f]{6}$/.test(String(got))) {
        throw new Error(`${group}.${key}는 #rrggbb 소문자 형식이어야 합니다`);
      }
      if (typeof got === 'string' && /[`$\\\n]/.test(got)) {
        throw new Error(`${group}.${key}에 쓸 수 없는 글자가 있습니다`);
      }
    }
  }
  if (Object.keys(record).length !== Object.keys(current).length) {
    throw new Error('알 수 없는 묶음이 있습니다');
  }
  return record as unknown as TokenSet;
}

/** tokens.ts에서 표시 구간 사이를 새 값으로 바꾼다. 형식은 Prettier가 다시 맞춘다. */
export function replaceTokenBlock(source: string, set: TokenSet): string {
  const start = source.indexOf(BLOCK_START);
  const end = source.indexOf(BLOCK_END);
  if (start < 0 || end < start)
    throw new Error('tokens.ts에서 tokens:start, tokens:end를 찾지 못했습니다');
  const body = `export const tokens = ${JSON.stringify(set, null, 2)} satisfies TokenSet;`;
  return `${source.slice(0, start)}${BLOCK_START}\n${body}\n${source.slice(end)}`;
}
