// KLAS 탭과 확장 표시가 쓰는 디자인 토큰.
// 값은 아래 tokens:start와 tokens:end 사이에만 둔다. `npm run tokens:preview`의 저장 버튼이
// 이 구간을 통째로 다시 쓰므로, 설명은 구간 밖의 tokenNotes에 적는다.

export interface TokenSet {
  color: Record<string, string>;
  fontFamily: Record<string, string>;
  fontSize: Record<string, number>;
  fontWeight: Record<string, number>;
  lineHeight: Record<string, number>;
  space: Record<string, number>;
  radius: Record<string, number>;
  size: Record<string, number>;
  shadow: Record<string, string>;
  zIndex: Record<string, number>;
  duration: Record<string, number>;
  easing: Record<string, string>;
}

// tokens:start
export const tokens = {
  color: {
    text: '#222222',
    'text-secondary': '#444444',
    'text-muted': '#666666',
    surface: '#ffffff',
    'surface-sunken': '#f5f5f5',
    'surface-hover': '#fafafa',
    border: '#dddddd',
    'border-subtle': '#e7e7e7',
    'border-strong': '#cccccc',
    brand: '#3a051f',
    'on-brand': '#ffffff',
    'brand-muted': '#afa5a9',
    accent: '#b10058',
    'accent-hover': '#8f0047',
    'accent-subtle': '#fbeef4',
    'on-accent': '#ffffff',
    'tab-border': '#dee2e6',
    urgent: '#a64400',
    'urgent-subtle': '#fdf0e6',
    'warning-text': '#856404',
    'warning-subtle': '#fff6db',
    'warning-border': '#f29d0c',
    'marker-on-dark': '#f29d0c',
    'marker-on-light': '#b10058',
    focus: '#b10058',
  },
  fontFamily: {
    base: '"Noto Sans KR", "Malgun Gothic", sans-serif',
  },
  fontSize: {
    xs: 12,
    sm: 13,
    md: 14,
    lg: 17,
  },
  fontWeight: {
    light: 300,
    regular: 400,
    medium: 500,
    bold: 700,
  },
  lineHeight: {
    tight: 1.4,
    body: 1.6,
  },
  space: {
    '1': 4,
    '2': 6,
    '3': 8,
    '4': 12,
    '5': 16,
    '6': 20,
    '7': 24,
  },
  radius: {
    sm: 2,
    md: 4,
    lg: 6,
    pill: 999,
  },
  size: {
    'drawer-width': 360,
    'narrow-breakpoint': 480,
    'brand-bar-height': 48,
    'tab-height': 40,
    'handle-width': 28,
    'handle-width-hover': 40,
    'handle-height': 72,
    'target-min': 44,
    icon: 20,
  },
  shadow: {
    drawer: '-8px 0 24px rgba(0, 0, 0, 0.16)',
    handle: '-2px 0 8px rgba(0, 0, 0, 0.2)',
  },
  zIndex: {
    overlay: 2147483000,
  },
  duration: {
    drawer: 200,
  },
  easing: {
    drawer: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  },
} satisfies TokenSet;
// tokens:end

export type TokenGroup = keyof TokenSet;
export type ColorToken = keyof typeof tokens.color;

/** CSS 변수 이름에 붙는 접두어와 단위. 숫자 값에만 단위를 붙인다. */
export const TOKEN_GROUPS: Record<TokenGroup, { prefix: string; unit: string; label: string }> = {
  color: { prefix: 'color', unit: '', label: '색' },
  fontFamily: { prefix: 'font-family', unit: '', label: '글꼴' },
  fontSize: { prefix: 'font-size', unit: 'px', label: '글자 크기' },
  fontWeight: { prefix: 'font-weight', unit: '', label: '글자 굵기' },
  lineHeight: { prefix: 'line-height', unit: '', label: '줄 높이' },
  space: { prefix: 'space', unit: 'px', label: '간격' },
  radius: { prefix: 'radius', unit: 'px', label: '모서리' },
  size: { prefix: 'size', unit: 'px', label: '크기' },
  shadow: { prefix: 'shadow', unit: '', label: '그림자' },
  zIndex: { prefix: 'z', unit: '', label: '겹침 순서' },
  duration: { prefix: 'duration', unit: 'ms', label: '움직임 시간' },
  easing: { prefix: 'easing', unit: '', label: '움직임 곡선' },
};

/** 토큰 하나의 CSS 변수 이름. 예: `--khp-color-accent` */
export const cssVar = (group: TokenGroup, key: string) =>
  `--khp-${TOKEN_GROUPS[group].prefix}-${key}`;

/** 토큰을 CSS 변수 선언 목록으로 바꾼다. */
export function cssDeclarations(set: TokenSet = tokens): [name: string, value: string][] {
  const out: [string, string][] = [];
  for (const group of Object.keys(TOKEN_GROUPS) as TokenGroup[]) {
    const { unit } = TOKEN_GROUPS[group];
    const values: Record<string, string | number> = set[group];
    for (const [key, value] of Object.entries(values)) {
      out.push([cssVar(group, key), typeof value === 'number' ? `${value}${unit}` : value]);
    }
  }
  return out;
}

/**
 * shadow root 맨 앞에 넣을 CSS. `reset`이면 `all: initial`로 KLAS에서 상속되는 글꼴, 색,
 * 줄 높이를 끊고 토큰을 선언한다. 글자 크기는 px로 둔다. rem은 KLAS 문서의 html 글자 크기를
 * 따르기 때문이다.
 */
export function tokensToCss(
  set: TokenSet = tokens,
  { selector = ':host', reset = true }: { selector?: string; reset?: boolean } = {},
): string {
  const lines = cssDeclarations(set).map(([name, value]) => `  ${name}: ${value};`);
  return [
    `${selector} {`,
    ...(reset ? ['  all: initial;'] : []),
    ...lines,
    `  font-family: var(${cssVar('fontFamily', 'base')});`,
    `  color: var(${cssVar('color', 'text')});`,
    `  line-height: var(${cssVar('lineHeight', 'body')});`,
    '}',
    '@media (prefers-reduced-motion: reduce) {',
    `  ${selector} {`,
    `    ${cssVar('duration', 'drawer')}: 0ms;`,
    '  }',
    '}',
  ].join('\n');
}

/** 토큰마다 쓰임새. 미리보기 페이지가 보여 준다. */
export const tokenNotes: Partial<Record<string, string>> = {
  'color.text': '본문, 제목 (KLAS body #222)',
  'color.text-secondary': '탭 이름, 칩 글자 (KLAS 흰 버튼 글자)',
  'color.text-muted': '보조 글자, 마지막 확인 시각 (KLAS .title-text span)',
  'color.surface': '서랍 바탕',
  'color.surface-sunken': '묶음 제목 바탕 (KLAS 표 머리 th)',
  'color.surface-hover': '항목에 마우스를 올렸을 때 (KLAS 표 행 hover)',
  'color.border': '서랍 테두리, 구분선 (KLAS 표 테두리)',
  'color.border-subtle': '항목 사이 선',
  'color.border-strong': '칩 테두리, 보조 버튼 테두리 (KLAS 흰 버튼 테두리)',
  'color.brand': '서랍 맨 위 "KLAS Helper+" 바 (KLAS 상단 바 .bg-top)',
  'color.on-brand': '브랜드 바 위 글자와 아이콘',
  'color.brand-muted': '브랜드 바 위 보조 글자 (KLAS 상단 .navtxt)',
  'color.accent': '선택된 탭, 링크, 손잡이, 주요 버튼 (KLAS .defaulttabs, .btn-learn)',
  'color.accent-hover': '주요 버튼과 손잡이에 마우스를 올렸을 때 (KLAS .btn-learn 테두리)',
  'color.accent-subtle': '"연장 기간" 같은 강조 칩 바탕',
  'color.on-accent': '강조색 위 글자와 아이콘',
  'color.tab-border': '탭 줄 아래 선 (KLAS .defaulttabs)',
  'color.urgent': '24시간 안 남은 시간 글자',
  'color.urgent-subtle': '24시간 안 남은 시간 바탕',
  'color.warning-text': '일부를 읽지 못했을 때 안내 글자',
  'color.warning-subtle': '일부를 읽지 못했을 때 안내 바탕',
  'color.warning-border': '일부를 읽지 못했을 때 안내 테두리 (KLAS 주황 #f29d0c)',
  'color.marker-on-dark': 'KLAS 상단 바 위 (+) 표시',
  'color.marker-on-light': 'KLAS 메뉴, 본문 위 (+) 표시',
  'color.focus': '키보드 포커스 테두리',
  'fontFamily.base':
    'KLAS와 같은 글꼴. Noto Sans KR은 KLAS 페이지가 이미 불러오므로 확장에 넣지 않는다.',
  'fontSize.md': 'KLAS 본문 크기',
  'fontWeight.light': 'KLAS 본문 굵기',
  'size.narrow-breakpoint':
    '이보다 좁은 창에서는 서랍이 화면 전체를 덮는다. 미디어 쿼리에는 CSS 변수를 쓸 수 없어 JS의 matchMedia에서 읽는다.',
  'size.brand-bar-height': '서랍 맨 위 "KLAS Helper+" 바 높이',
  'size.tab-height': '탭 줄 높이',
  'size.target-min': '누를 수 있는 요소의 최소 크기',
  'zIndex.overlay': '서랍과 손잡이. KLAS 팝업보다 위에 온다.',
  'duration.drawer': '서랍이 열리고 닫히는 시간. 움직임 줄이기 설정이면 0이 된다.',
};

/** KLAS 상단 바 바탕 (style.css의 .bg-top, 2026-11-06 확인). */
export const KLAS_HEADER_BG = '#3a051f';

export interface ContrastPair {
  fg: ColorToken;
  /** 토큰 이름이나 KLAS 화면처럼 토큰 밖의 색 */
  bg: ColorToken | `#${string}`;
  /** 글자는 4.5, 테두리나 아이콘 같은 글자 아닌 요소는 3 */
  min: number;
  use: string;
}

export const CONTRAST_PAIRS: ContrastPair[] = [
  { fg: 'text', bg: 'surface', min: 4.5, use: '본문' },
  { fg: 'text-secondary', bg: 'surface', min: 4.5, use: '선택되지 않은 탭, 칩' },
  { fg: 'text-secondary', bg: 'surface-sunken', min: 4.5, use: '묶음 제목' },
  { fg: 'text-muted', bg: 'surface', min: 4.5, use: '보조 글자' },
  { fg: 'text-muted', bg: 'surface-sunken', min: 4.5, use: '묶음 제목 옆 개수' },
  { fg: 'text-muted', bg: 'surface-hover', min: 4.5, use: '마우스를 올린 항목의 보조 글자' },
  { fg: 'on-brand', bg: 'brand', min: 4.5, use: '"KLAS Helper+" 바 제목' },
  { fg: 'brand-muted', bg: 'brand', min: 4.5, use: '브랜드 바 보조 글자' },
  { fg: 'accent', bg: 'surface', min: 4.5, use: '선택된 탭, 링크' },
  { fg: 'accent', bg: 'accent-subtle', min: 4.5, use: '강조 칩' },
  { fg: 'on-accent', bg: 'accent', min: 4.5, use: '주요 버튼 글자' },
  { fg: 'on-accent', bg: 'accent-hover', min: 4.5, use: '마우스를 올린 주요 버튼' },
  { fg: 'urgent', bg: 'urgent-subtle', min: 4.5, use: '24시간 안 남은 시간' },
  { fg: 'warning-text', bg: 'warning-subtle', min: 4.5, use: '읽지 못한 목록 안내' },
  { fg: 'marker-on-light', bg: 'surface', min: 4.5, use: 'KLAS 메뉴, 본문의 (+) 표시' },
  { fg: 'marker-on-dark', bg: KLAS_HEADER_BG, min: 4.5, use: 'KLAS 상단 바의 (+) 표시' },
  { fg: 'focus', bg: 'surface', min: 3, use: '포커스 테두리' },
  { fg: 'accent', bg: 'surface', min: 3, use: '선택된 탭 밑줄' },
];

function luminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match?.[1]) throw new Error(`#rrggbb 형식이 아닌 색: ${hex}`);
  const n = parseInt(match[1], 16);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

/** WCAG 2 대비비. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** 짝의 실제 색. 토큰 이름이면 set에서 찾는다. */
export function resolvePair(pair: ContrastPair, set: TokenSet = tokens): [fg: string, bg: string] {
  const colorOf = (name: string) => (name.startsWith('#') ? name : (set.color[name] ?? ''));
  return [colorOf(pair.fg), colorOf(pair.bg)];
}
