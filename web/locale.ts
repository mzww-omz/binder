// Keep the API contract unchanged; translate its existing messages at the UI boundary.
const apiErrors: Record<string, string> = {
  'Cross-origin request denied': 'この操作は許可されていません。',
  'Request too large': '送信データが大きすぎます。',
  'Expected application/json': '送信形式が正しくありません。',
  'Invalid JSON': '送信データを読み取れませんでした。',
  'Expected an object': '送信データの形式が正しくありません。',
  'Unknown field': '入力項目が正しくありません。',
  'Name must be 1–200 characters': '名前は1〜200文字で入力してください。',
  'Invalid URL': 'URLが正しくありません。',
  'Use an http or https URL without credentials': 'httpまたはhttpsで始まる、ユーザー名・パスワードを含まないURLを入力してください。',
  'URL too long': 'URLは2,048文字以内で入力してください。',
  'Invalid parent': '移動先のフォルダーが正しくありません。',
  'Binder not found or expired': 'Binderが見つからないか、有効期限が切れています。',
  'Edit URL required': '編集用URLから開いてください。',
  'Invalid edit token': '編集用URLが正しくありません。',
  'Choose folder or link': 'フォルダーまたはリンクを指定してください。',
  'Folders cannot have a URL': 'フォルダーにURLは設定できません。',
  'No changes supplied': '変更内容がありません。',
  'Item not found': '項目が見つかりません。再読み込みしてお試しください。',
  'Item not found or Binder expired': '項目が見つからないか、Binderの有効期限が切れています。',
  'Invalid order': '並び順が正しくありません。',
  'Order must contain every sibling exactly once': '並び順が正しくありません。再読み込みしてお試しください。',
  'Items changed. Reload and try again.': '内容が変更されています。再読み込みしてお試しください。',
  'Daily Binder creation limit reached (50 per IP).': '同じIPアドレスから作成できるBinderは1日50件までです。日本時間の午前0時以降にお試しください。',
  'Creation limit unavailable': '作成制限を確認できませんでした。しばらくしてからお試しください。',
  'Creation limit reached. Please try later.': '作成上限に達しました。しばらくしてからお試しください。',
  'A Binder can hold up to 200 items': '1つのBinderに追加できる項目は200件までです。',
  'Invalid item or destination': '項目や移動先を確認してください。',
  'Unable to save. Please try again.': '保存できませんでした。もう一度お試しください。',
  'Not found': '対象が見つかりません。',
};

export function apiErrorMessage(message: unknown, status: number): string {
  if (typeof message === 'string' && Object.hasOwn(apiErrors, message)) return apiErrors[message];
  // Unknown server messages can contain internal information; never display them verbatim.
  if (status >= 500) return 'サーバーでエラーが発生しました。しばらくしてからお試しください。';
  const fallback: Record<number, string> = {
    400: '入力内容を確認してください。',
    401: '編集用URLから開いてください。',
    403: 'この操作は許可されていません。',
    404: '対象が見つからないか、有効期限が切れています。',
    409: '内容が変更されています。再読み込みしてお試しください。',
    413: '送信データが大きすぎます。',
    415: '送信形式が正しくありません。',
    429: '作成上限に達しました。しばらくしてからお試しください。',
  };
  return fallback[status] ?? '処理できませんでした。もう一度お試しください。';
}

export function remainingTime(milliseconds: number): string {
  if (milliseconds <= 0) return '有効期限が切れています';
  const hours = Math.floor(milliseconds / 3600000);
  if (hours >= 24) return `残り${Math.floor(hours / 24)}日${hours % 24}時間`;
  const minutes = Math.floor(milliseconds / 60000) % 60;
  if (hours) return `残り${hours}時間${minutes}分`;
  return minutes ? `残り${minutes}分` : '残り1分未満';
}
