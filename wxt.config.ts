import { defineConfig } from 'wxt';

// https://wxt.dev/api/config.html
export default defineConfig({
  // npm run dev로 열리는 브라우저 설정. 모두 같이 쓰는 값만 둔다.
  // 브라우저 경로와 프로필 같은 개인 설정은 web-ext.config.ts에 둔다. (web-ext.config.example.ts 참고)
  webExt: {
    startUrls: ['https://klas.kw.ac.kr/'],
  },
  // Firefox도 Chrome과 같은 Manifest V3로 빌드한다. (WXT 기본값은 Firefox만 MV2)
  manifestVersion: 3,
  manifest: ({ browser }) => ({
    // storage: 설정과 세션 연장 대상 탭을 저장한다.
    // alarms: KLAS 탭이 열려 있는 동안 10분마다 세션을 연장한다.
    permissions: ['storage', 'alarms'],
    name: 'KLAS Helper Extension Plus',
    description:
      '광운대학교 KLAS의 과제, 강의, 팀 프로젝트, 퀴즈 마감을 KLAS 화면 안에서 한곳에 모아 보는 확장',
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          // AMO에 처음 올린 뒤에는 바꿀 수 없다.
          id: 'klas-helper-extension-plus@jundragon7419',
          // 외부로 보내는 데이터가 없다. PRIVACY.md 참고
          data_collection_permissions: { required: ['none'] },
        },
      },
    }),
  }),
});
