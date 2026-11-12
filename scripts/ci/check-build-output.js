// 빌드한 확장(.output/<대상>)의 manifest.json을 검사한다.
// 확장이 브라우저에 올라가지 않는 원인(참조한 파일 없음, 잘못된 background, MV2 빌드)과
// 몰래 늘어난 권한을 브라우저 없이 잡는다. CI의 check 작업이 빌드 뒤에 실행하고,
// tests/check-build-output.test.ts가 판단 함수를 검사한다.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** 검사할 빌드 대상과 각 대상의 background 형식 */
export const TARGETS = {
  'chrome-mv3': { background: 'service_worker' },
  'firefox-mv3': { background: 'scripts' },
};

/** content script가 붙을 수 있는 주소. KLAS 밖으로 넓어지면 실패한다. */
export const ALLOWED_MATCH_PREFIX = 'https://klas.kw.ac.kr/';

/**
 * 권한과 접근 범위를 비교하기 좋은 형태로 모은다.
 * 권한 스냅샷(scripts/ci/manifest-access.json)과 비교한다.
 */
export function accessSummary(manifest) {
  const sorted = (list) => [...new Set(list ?? [])].sort();
  return {
    permissions: sorted(manifest.permissions),
    optional_permissions: sorted(manifest.optional_permissions),
    host_permissions: sorted(manifest.host_permissions),
    optional_host_permissions: sorted(manifest.optional_host_permissions),
    content_script_matches: sorted(
      (manifest.content_scripts ?? []).flatMap((s) => s.matches ?? []),
    ),
  };
}

/** manifest가 참조하는 파일 경로를 모은다. 와일드카드가 들어간 경로는 건너뛴다. */
export function referencedFiles(manifest) {
  const files = [];
  const add = (value) => {
    if (typeof value === 'string') files.push(value);
    else if (value && typeof value === 'object') Object.values(value).forEach(add);
  };
  add(manifest.background?.service_worker);
  add(manifest.background?.scripts);
  add(manifest.background?.page);
  for (const script of manifest.content_scripts ?? []) {
    add(script.js);
    add(script.css);
  }
  add(manifest.icons);
  add(manifest.action?.default_icon);
  add(manifest.action?.default_popup);
  add(manifest.options_page);
  add(manifest.options_ui?.page);
  add(manifest.side_panel?.default_path);
  add(manifest.sidebar_action?.default_panel);
  for (const entry of manifest.web_accessible_resources ?? []) add(entry.resources);
  return [...new Set(files.filter((f) => !f.includes('*')).map((f) => f.replace(/^\//, '')))];
}

/**
 * @param {object} input
 * @param {string} input.target 빌드 대상 이름 (TARGETS의 키)
 * @param {any} input.manifest 빌드된 manifest.json
 * @param {(path: string) => boolean} input.fileExists 빌드 폴더 기준 상대 경로가 있는지
 * @param {any} input.expectedAccess 권한 스냅샷의 이 대상 값
 * @returns {string[]} 문제 목록. 비어 있으면 통과.
 */
export function checkManifest({ target, manifest, fileExists, expectedAccess }) {
  const errors = [];
  const spec = TARGETS[target];
  if (!spec) return [`알 수 없는 빌드 대상입니다: ${target}`];

  if (manifest.manifest_version !== 3) {
    errors.push(`manifest_version이 3이 아닙니다: ${manifest.manifest_version}`);
  }
  for (const key of ['name', 'version']) {
    if (typeof manifest[key] !== 'string' || manifest[key] === '')
      errors.push(`${key}가 없습니다.`);
  }

  const background = manifest.background ?? {};
  if (spec.background === 'service_worker') {
    if (typeof background.service_worker !== 'string') {
      errors.push('background.service_worker가 없습니다.');
    }
  } else if (!Array.isArray(background.scripts) || background.scripts.length === 0) {
    errors.push('background.scripts가 없습니다.');
  }

  if (target.startsWith('firefox') && !manifest.browser_specific_settings?.gecko?.id) {
    errors.push('browser_specific_settings.gecko.id가 없습니다.');
  }

  const scripts = manifest.content_scripts ?? [];
  if (scripts.length === 0) errors.push('content_scripts가 없습니다.');
  scripts.forEach((script, i) => {
    if (!script.matches?.length) errors.push(`content_scripts[${i}]에 matches가 없습니다.`);
    if (!script.js?.length && !script.css?.length) {
      errors.push(`content_scripts[${i}]에 js와 css가 모두 없습니다.`);
    }
    for (const match of script.matches ?? []) {
      if (!match.startsWith(ALLOWED_MATCH_PREFIX)) {
        errors.push(`content_scripts[${i}]가 KLAS 밖 주소에 붙습니다: ${match}`);
      }
    }
  });

  for (const file of referencedFiles(manifest)) {
    if (!fileExists(file)) errors.push(`manifest가 참조하는 파일이 빌드에 없습니다: ${file}`);
  }

  const actual = accessSummary(manifest);
  if (!expectedAccess) {
    errors.push(`권한 스냅샷에 ${target} 항목이 없습니다.`);
  } else {
    for (const [key, value] of Object.entries(actual)) {
      const expected = expectedAccess[key] ?? [];
      if (JSON.stringify(value) !== JSON.stringify([...expected].sort())) {
        errors.push(
          `${key}가 권한 스냅샷과 다릅니다. 빌드: ${JSON.stringify(value)}, 스냅샷: ${JSON.stringify(expected)}. ` +
            '의도한 변경이면 scripts/ci/manifest-access.json을 고치고 PR에 이유를 적습니다.',
        );
      }
    }
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const expected = JSON.parse(
    readFileSync(new URL('./manifest-access.json', import.meta.url), 'utf8'),
  );
  let failed = false;
  for (const target of Object.keys(TARGETS)) {
    const dir = join('.output', target);
    const manifestPath = join(dir, 'manifest.json');
    if (!existsSync(manifestPath)) {
      console.log(
        `::error::${manifestPath}가 없습니다. npm run build, npm run build:firefox를 먼저 실행합니다.`,
      );
      failed = true;
      continue;
    }
    const errors = checkManifest({
      target,
      manifest: JSON.parse(readFileSync(manifestPath, 'utf8')),
      fileExists: (file) => existsSync(join(dir, file)),
      expectedAccess: expected[target],
    });
    for (const error of errors) console.log(`::error::${target}: ${error}`);
    if (errors.length > 0) failed = true;
    else console.log(`${target}: manifest 검사 통과`);
  }
  if (failed) process.exit(1);
}
