export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(({ reason }) => {
    console.log(`[KLAS Helper Plus] installed (${reason})`);
  });
});
