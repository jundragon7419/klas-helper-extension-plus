import { describe, expect, it, vi } from 'vitest';
import { isNoReceiverError, withReceiverRetry } from '@/utils/send-message';

const noReceiver = () => new Error('Could not establish connection. Receiving end does not exist.');

describe('withReceiverRetry', () => {
  const sleep = vi.fn(() => Promise.resolve());

  it('background 리스너가 아직 없으면 기다렸다가 다시 보낸다 (0.5초, 1초)', async () => {
    sleep.mockClear();
    const send = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(noReceiver())
      .mockRejectedValueOnce(noReceiver())
      .mockResolvedValue('ok');
    await expect(withReceiverRetry(send, { sleep })).resolves.toBe('ok');
    expect(send).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[500], [1000]]);
  });

  it('세 번 다시 보내도 안 되면 오류를 던진다', async () => {
    const send = vi.fn(() => Promise.reject(noReceiver()));
    await expect(withReceiverRetry(send, { sleep })).rejects.toThrow('Receiving end');
    expect(send).toHaveBeenCalledTimes(4);
  });

  it('다른 오류는 다시 보내지 않고 바로 던진다', async () => {
    const send = vi.fn(() => Promise.reject(new Error('Extension context invalidated.')));
    await expect(withReceiverRetry(send, { sleep })).rejects.toThrow('invalidated');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('리스너가 없다는 오류를 구분한다', () => {
    expect(isNoReceiverError(noReceiver())).toBe(true);
    expect(isNoReceiverError('Could not establish connection')).toBe(true);
    expect(isNoReceiverError(new Error('Access to storage is not allowed'))).toBe(false);
  });
});
