import { expect, test } from 'vitest';
import { apiErrorMessage, remainingTime } from '../web/locale';

test.each([
  [604799999, '残り6日23時間'],
  [86400000, '残り1日0時間'],
  [86399999, '残り23時間59分'],
  [3600000, '残り1時間0分'],
  [60000, '残り1分'],
  [59999, '残り1分未満'],
  [1, '残り1分未満'],
  [0, '有効期限が切れています'],
  [-1, '有効期限が切れています'],
])('期限まで %i ms を日本語で表示する', (milliseconds, expected) => {
  expect(remainingTime(milliseconds)).toBe(expected);
});

test.each([
  ['Invalid edit token', 401, '編集用URLが正しくありません。'],
  ['Binder not found or expired', 404, 'Binderが見つからないか、有効期限が切れています。'],
  ['Name must be 1–200 characters', 400, '名前は1〜200文字で入力してください。'],
  ['A Binder can hold up to 200 items', 409, '1つのBinderに追加できる項目は200件までです。'],
  ['Daily Binder creation limit reached (50 per IP).', 429, '同じIPアドレスから作成できるBinderは1日50件までです。日本時間の午前0時以降にお試しください。'],
  ['Creation limit unavailable', 503, '作成制限を確認できませんでした。しばらくしてからお試しください。'],
  ['Creation limit reached. Please try later.', 429, '作成上限に達しました。しばらくしてからお試しください。'],
  ['Items changed. Reload and try again.', 409, '内容が変更されています。再読み込みしてお試しください。'],
  ['Unrecognized server message with private details', 503, 'サーバーでエラーが発生しました。しばらくしてからお試しください。'],
  [null, 401, '編集用URLから開いてください。'],
  [{ error: 'private' }, 400, '入力内容を確認してください。'],
  ['toString', 500, 'サーバーでエラーが発生しました。しばらくしてからお試しください。'],
  ['Unknown', 418, '処理できませんでした。もう一度お試しください。'],
])('APIエラー %s を日本語で案内する', (message, status, expected) => {
  expect(apiErrorMessage(message, status)).toBe(expected);
});
