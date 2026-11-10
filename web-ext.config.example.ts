// npm run dev의 개인 설정 예시.
// 이 파일을 web-ext.config.ts로 복사해서 자기 환경에 맞게 고친다.
// web-ext.config.ts는 git에 올라가지 않는다.
import { defineWebExtConfig } from 'wxt';

export default defineWebExtConfig({
  // Chrome 대신 Edge를 띄운다. Chrome을 쓰면 binaries를 지운다.
  // 경로는 Edge 주소창에 edge://version을 입력하면 "실행 파일 경로"에 나온다.
  binaries: {
    chrome: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  },
  // 개발용 프로필을 저장소 밖 고정 경로에 둔다. 평소에 쓰는 프로필과 다른 폴더여야 한다.
  // 저장한 비밀번호와 설정은 남지만, KLAS 로그인 쿠키는 세션 쿠키라 브라우저를 닫으면 지워진다.
  // Windows에서는 절대 경로를 쓴다. 폴더가 없으면 처음 실행할 때 만들어진다.
  chromiumProfile: 'C:/code/.klas-helper-dev-profile',
  // 이 값이 없으면 web-ext가 프로필을 임시 폴더로 복사해서 쓰므로 변경 사항이 저장되지 않는다.
  keepProfileChanges: true,
});
