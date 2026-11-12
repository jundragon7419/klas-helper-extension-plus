import { describe, expect, it } from 'vitest';
import { accessSummary, checkManifest, referencedFiles } from '../scripts/ci/check-build-output.js';

// 빌드 산출물 검사(scripts/ci/check-build-output.js)의 판단을 검사한다.
const chrome = () => ({
  manifest_version: 3,
  name: 'KLAS Helper Extension Plus',
  version: '0.1.0',
  permissions: ['storage', 'alarms'],
  background: { service_worker: 'background.js' },
  content_scripts: [
    {
      matches: ['https://klas.kw.ac.kr/*'],
      js: ['content-scripts/klas.js'],
      css: ['content-scripts/klas.css'],
    },
  ],
});

const firefox = (): Record<string, unknown> => {
  return {
    ...chrome(),
    background: { scripts: ['background.js'] },
    browser_specific_settings: { gecko: { id: 'klas-helper-extension-plus@jundragon7419' } },
  };
};

const access = (over = {}) => ({
  permissions: ['alarms', 'storage'],
  content_script_matches: ['https://klas.kw.ac.kr/*'],
  ...over,
});

const run = (target: string, manifest: unknown, missing: string[] = [], expected = access()) =>
  checkManifest({
    target,
    manifest,
    fileExists: (file) => !missing.includes(file),
    expectedAccess: expected,
  });

describe('checkManifest', () => {
  it('정상 빌드는 통과한다', () => {
    expect(run('chrome-mv3', chrome())).toEqual([]);
    expect(run('firefox-mv3', firefox())).toEqual([]);
  });

  it('참조한 파일이 빌드에 없으면 실패한다', () => {
    expect(run('chrome-mv3', chrome(), ['content-scripts/klas.js'])).toEqual([
      'manifest가 참조하는 파일이 빌드에 없습니다: content-scripts/klas.js',
    ]);
    expect(run('chrome-mv3', chrome(), ['background.js'])[0]).toContain('background.js');
  });

  it('MV2 빌드는 실패한다', () => {
    expect(run('chrome-mv3', { ...chrome(), manifest_version: 2 })[0]).toContain(
      'manifest_version',
    );
  });

  it('대상에 맞는 background 형식이 없으면 실패한다', () => {
    expect(
      run('chrome-mv3', { ...chrome(), background: { scripts: ['background.js'] } }),
    ).toContain('background.service_worker가 없습니다.');
    expect(
      run('firefox-mv3', { ...firefox(), background: { service_worker: 'background.js' } }),
    ).toContain('background.scripts가 없습니다.');
  });

  it('Firefox 빌드에 gecko id가 없으면 실패한다', () => {
    const noId = firefox();
    delete noId.browser_specific_settings;
    expect(run('firefox-mv3', noId)).toContain('browser_specific_settings.gecko.id가 없습니다.');
  });

  it('content script가 KLAS 밖 주소에 붙으면 실패한다', () => {
    const manifest = chrome();
    manifest.content_scripts[0]!.matches = ['<all_urls>'];
    const errors = run(
      'chrome-mv3',
      manifest,
      [],
      access({ content_script_matches: ['<all_urls>'] }),
    );
    expect(errors).toEqual(['content_scripts[0]가 KLAS 밖 주소에 붙습니다: <all_urls>']);
  });

  it('권한이 스냅샷과 다르면 실패한다', () => {
    const errors = run('chrome-mv3', { ...chrome(), permissions: ['storage', 'alarms', 'tabs'] });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('permissions가 권한 스냅샷과 다릅니다');
  });

  it('host_permissions가 생기면 실패한다', () => {
    const errors = run('chrome-mv3', { ...chrome(), host_permissions: ['https://*/*'] });
    expect(errors[0]).toContain('host_permissions');
  });

  it('스냅샷에 대상이 없으면 실패한다', () => {
    expect(
      checkManifest({
        target: 'chrome-mv3',
        manifest: chrome(),
        fileExists: () => true,
        expectedAccess: undefined,
      }),
    ).toEqual(['권한 스냅샷에 chrome-mv3 항목이 없습니다.']);
  });

  it('알 수 없는 대상은 실패한다', () => {
    expect(run('safari-mv3', chrome())).toEqual(['알 수 없는 빌드 대상입니다: safari-mv3']);
  });
});

describe('referencedFiles', () => {
  it('아이콘, 팝업, 공개 리소스 경로도 모으고 와일드카드는 건너뛴다', () => {
    expect(
      referencedFiles({
        icons: { 16: 'icon/16.png', 48: '/icon/48.png' },
        action: { default_popup: 'popup.html', default_icon: 'icon/16.png' },
        web_accessible_resources: [{ resources: ['assets/*.svg', 'fonts/a.woff2'] }],
      }).sort(),
    ).toEqual(['fonts/a.woff2', 'icon/16.png', 'icon/48.png', 'popup.html']);
  });
});

describe('accessSummary', () => {
  it('중복을 없애고 정렬한다', () => {
    expect(
      accessSummary({
        permissions: ['storage', 'alarms', 'storage'],
        content_scripts: [{ matches: ['b'] }, { matches: ['a', 'b'] }],
      }),
    ).toEqual({
      permissions: ['alarms', 'storage'],
      optional_permissions: [],
      host_permissions: [],
      optional_host_permissions: [],
      content_script_matches: ['a', 'b'],
    });
  });
});
