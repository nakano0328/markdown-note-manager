# markdown-note-manager

大学の授業ノート（Markdown）をローカルで快適に編集し、授業終了時に GitHub へ一元同期するための SvelteKit 製ローカルアプリです。

- ローカルディレクトリをそのままサイドバーに反映
- WYSIWYG ライクなリアルタイムプレビュー（marked + KaTeX + Shiki）
- 入力停止後の自動保存 / Cmd+S 即時保存
- 画像ペーストで `images/` ディレクトリに自動保存
- 時間割・課題ダッシュボード / 月別カレンダー（祝日・休校・振替）
- Smart Frontmatter（連番自動採番、前回ノートの教室情報を継承）
- ワンクリックで `git add` → `commit` → `push`

## 必要環境

- Node.js 20 以上
- npm
- Git（コミット・プッシュは [`simple-git`](https://github.com/steveukx/git-js) 経由）
- 同期したいノート用 Git リポジトリ（GitHub などにリモート設定済み）

## セットアップ手順

### 1. リポジトリを取得

```bash
git clone <this-repo-url>
cd markdown-note-manager
npm install
```

### 2. ノート保存先 (NOTES_DIR) を準備

このアプリは **アプリ本体とノートのリポジトリを分離** して扱います。
ノート保存用ディレクトリを別途用意し、その絶対パスを `.env` に設定します。

```bash
# まだノート用リポジトリが無い場合の例:
mkdir -p ~/notes
cd ~/notes
git init
git remote add origin git@github.com:<user>/<notes-repo>.git
# 任意で初回コミット & プッシュ
git commit --allow-empty -m "init"
git push -u origin main
```

> `Push` ボタンを使うには、`NOTES_DIR` が **`git init` 済み** かつ **少なくとも 1 つのリモート（通常は `origin`）が設定済み** である必要があります。

### 3. 環境変数を設定

`.env.example` をコピーして `.env` を作成し、上で用意したディレクトリの絶対パスを書きます。

```bash
cp .env.example .env
```

`.env`:

```env
NOTES_DIR=/Users/yourname/notes
```

- 相対パスは不可。必ず **絶対パス** にしてください。
- 値を変更したら開発サーバを再起動します。

### 4. 開発サーバを起動

```bash
npm run dev
```

`http://localhost:5173` を開きます。

サイドバーに `NOTES_DIR` 配下のディレクトリ／Markdown／画像が並んでいれば成功です。

### 5. 本番ビルド

```bash
npm run build
npm run preview
```

本番運用する場合は `@sveltejs/adapter-node` で生成された `build/` を Node で起動してください。

```bash
node build
```

## 主な使い方

### 新規ノート作成（Smart Frontmatter）

- 時間割の **科目入りコマ** をクリック → 新規ノート作成モーダルが開きます。
- サイドバーの科目フォルダ（`<学年>/<春|秋>/<科目>`）にカーソルを当てると右側に **`+`** ボタンが表示され、クリックで新規作成できます。
- モーダルでは以下が自動入力されます。
  - **連番**: そのディレクトリ内の最大連番 +1 を 2 桁ゼロ埋め
  - **日付**: 本日（ローカル日付）。必要に応じて変更できます
  - **教室 (location)**: 直前のノートの Frontmatter から継承
  - **スライド URL**: 毎回手動入力（継承しません）
- ファイル名は `NN_<タイトル>.md` 形式で `NOTES_DIR/<directory>/` 配下に保存され、エディタへ遷移します。

時間割コマの **科目設定（時間割側）** を編集したい場合は、コマにカーソルを当てると右上に出る ✎ アイコンから開けます。

### 自動保存と画像ペースト

- 入力が止まってから 30 秒で自動保存。`Cmd/Ctrl + S` で即時保存。
- エディタにスクリーンショットをペースト / ドロップすると `images/` 配下に自動保存され、`![image](./images/xxx.png)` がカーソル位置に挿入されます。

### 時間割・カレンダー

- ホームの時間割は学期ごとに保存され、空きコマをクリックすると科目を登録できます。
- `/calendar` で祝日・休校・曜日振替・日付振替・コマ単位の差替えが登録できます。

### Push（GitHub 同期）

- 右上の **Push** ボタンで `NOTES_DIR` の差分を一括コミット & プッシュします。
- コミットメッセージは以下のルールで自動生成されます。
  - 変更が単一ノート: `<科目フォルダ名>_<連番>_<ノート名>`
  - 複数ノート: `<科目 or multiple>_<件数>notes_update`
  - ノート以外のみ: `notes update <YYYY-MM-DD HH:mm>`
- 失敗時はヘッダーにエラー内容が表示されます。`NOTES_DIR` がリポジトリでない／リモート未設定／認証失敗などが代表的な原因です。

## ディレクトリ規約

```
<NOTES_DIR>/
  <学年>/
    <春|秋>/
      <科目名>/
        01_<タイトル>.md
        02_<タイトル>.md
        images/
          <auto>.png
  timetable.json
  timetable-settings.json
  calendar.json
```

- Markdown ファイル名は `^(\d{2})_(.+)\.md$` を満たすこと（連番採番のため）。
- `images/` 配下はアプリが自動生成します。

## スクリプト

| コマンド | 用途 |
| --- | --- |
| `npm run dev` | 開発サーバ |
| `npm run build` | 本番ビルド |
| `npm run preview` | 本番ビルドのローカル確認 |
| `npm run check` | 型・Svelte チェック |

## トラブルシューティング

- **サイドバーに何も出ない / `NOTES_DIR is not set`**
  → `.env` の `NOTES_DIR` が未設定、または相対パスです。絶対パスを設定し直してサーバを再起動してください。
- **Push が失敗する**
  → `NOTES_DIR` が Git リポジトリでない、または `origin` が未設定の可能性があります。`cd "$NOTES_DIR" && git status && git remote -v` で確認してください。
  → SSH 鍵やトークンが期限切れの場合は通常の `git push` と同じ手順で再設定が必要です。
- **連番が想定通りに振られない**
  → 同じディレクトリ内に `NN_*.md` 以外のファイルや、連番が重複した Markdown がないか確認してください。アプリは正規表現にマッチする最大の数字 +1 を採用します。
