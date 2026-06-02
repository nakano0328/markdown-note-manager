# ローカルLLM機能 設計書

## 1. 目的

この設計書は、markdown-note-manager に軽量なローカルLLM機能を追加するための設計を定義する。既存の `docs/requirements.md` とは独立した追加設計として扱う。

主目的は以下の通り。

- 授業ノートの編集作業をローカル環境だけで補助する。
- ノート本文を外部APIへ送信せず、プライバシーを維持する。
- ノートPCでも動く無料モデルを前提に、軽量な体験から導入する。
- 将来的にノート横断検索やRAGへ拡張できる構造にする。

## 2. 前提

### 2.1 実行環境

- SvelteKit アプリは既存どおり Node.js 上で動作する。
- LLM 推論はアプリ内に組み込まず、外部のローカルLLMサーバーへ委譲する。
- 最初の対応プロバイダは Ollama とする。
- 将来的に LM Studio / llama.cpp などの OpenAI互換APIへ差し替え可能にする。

### 2.2 推奨モデル

MVP では以下を推奨する。

| 用途 | モデル | 理由 |
| --- | --- | --- |
| テキスト生成 | `qwen2.5:1.5b` | 軽量で日本語対応があり、ノートPCでも扱いやすい |
| 品質優先の生成 | `qwen2.5:3b` | 1.5B より応答品質が高い。動作が重い場合は 1.5B に戻す |
| 埋め込み | `nomic-embed-text` | RAG 用の軽量な埋め込みモデル |

初期導入では `qwen2.5:1.5b` のみを必須とし、`nomic-embed-text` は RAG 実装フェーズで追加する。

## 3. 機能スコープ

### 3.1 MVPで実装する機能

エディタ画面に、現在のノートまたは選択範囲に対して実行できるAI補助を追加する。

- 選択範囲を要約
- 選択範囲を箇条書きへ整形
- 誤字脱字・表現を自然な日本語へ修正
- 本文から TODO 候補を抽出
- 現在ノートのタグ候補を提案
- 現在ノートの末尾に「まとめ」を生成

MVP ではAIの出力を自動保存しない。ユーザーが結果を確認し、挿入または置換を選ぶ。

### 3.2 MVPでは実装しない機能

- ノート横断RAG
- 画像の内容理解
- 自動でファイルを書き換えるエージェント
- Git push まで含む自動作業
- バックグラウンドでの常時インデックス更新

これらは後続フェーズで扱う。

## 4. 全体アーキテクチャ

```txt
Browser
  |
  | fetch
  v
SvelteKit API
  |
  | local HTTP
  v
Ollama
  |
  v
Local model
```

SvelteKit は以下の責務を持つ。

- UI からのAI操作リクエストを受け取る。
- ノート本文、選択範囲、ファイルパスなどを検証する。
- 操作種別ごとのプロンプトを組み立てる。
- Ollama API を呼び出す。
- 生成結果を UI に返す。

Ollama は以下の責務を持つ。

- モデルの管理
- ローカル推論
- 生成または埋め込みの実行

## 5. 環境変数

`.env.example` に以下を追加する。

```env
# ローカルLLM設定
LLM_PROVIDER=ollama
LLM_BASE_URL=http://localhost:11434
LLM_MODEL=qwen2.5:1.5b
LLM_EMBEDDING_MODEL=nomic-embed-text
LLM_TIMEOUT_MS=60000
```

### 5.1 設定項目

| 変数 | 必須 | 初期値 | 説明 |
| --- | --- | --- | --- |
| `LLM_PROVIDER` | 任意 | `ollama` | LLMプロバイダ。初期実装では `ollama` のみ |
| `LLM_BASE_URL` | 任意 | `http://localhost:11434` | ローカルLLMサーバーのURL |
| `LLM_MODEL` | 任意 | `qwen2.5:1.5b` | 生成に使うモデル |
| `LLM_EMBEDDING_MODEL` | 任意 | `nomic-embed-text` | RAG用の埋め込みモデル |
| `LLM_TIMEOUT_MS` | 任意 | `60000` | LLM呼び出しのタイムアウト |

設定が空の場合でもアプリ本体は起動できる。LLM機能を使ったときだけ接続エラーを表示する。

## 6. サーバー設計

### 6.1 ディレクトリ構成

```txt
src/lib/server/llm/
  config.ts
  provider.ts
  ollama.ts
  prompts.ts
  actions.ts

src/routes/api/ai/
  status/+server.ts
  action/+server.ts
```

将来のRAG対応時に以下を追加する。

```txt
src/lib/server/llm/
  chunk.ts
  embeddings.ts
  rag-index.ts

src/routes/api/ai/
  index/+server.ts
  chat/+server.ts
```

### 6.2 `provider.ts`

LLMプロバイダ差し替え用の共通インターフェースを定義する。

```ts
export interface LlmMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export interface GenerateOptions {
	temperature?: number;
	maxTokens?: number;
	signal?: AbortSignal;
}

export interface LlmProvider {
	generate(messages: LlmMessage[], options?: GenerateOptions): Promise<string>;
	health(): Promise<{ ok: boolean; model: string; message?: string }>;
}
```

MVP では `generate` と `health` のみ実装する。

### 6.3 `ollama.ts`

Ollama の `/api/chat` を呼び出す。

主な方針:

- `stream: false` で実装を始める。
- UI の応答性が問題になった段階でストリーミング対応を追加する。
- タイムアウトは `AbortController` で制御する。
- LLMサーバー未起動時は UI に分かる日本語メッセージを返す。

### 6.4 `prompts.ts`

操作種別ごとのプロンプトを集約する。

共通ルール:

- 回答は日本語。
- Markdown を壊さない。
- 元の情報にない事実を足さない。
- 不明な点は推測せず「不明」と書く。
- 出力だけを返し、余計な前置きは避ける。

### 6.5 `actions.ts`

UI から受け取る操作種別を定義する。

```ts
export type AiAction =
	| 'summarize'
	| 'bulletize'
	| 'polish'
	| 'extract_tasks'
	| 'suggest_tags'
	| 'append_summary';
```

各アクションは以下の入出力方針にする。

| アクション | 入力 | 出力 | UI反映 |
| --- | --- | --- | --- |
| `summarize` | 選択範囲または本文 | Markdown要約 | 挿入 |
| `bulletize` | 選択範囲 | 箇条書きMarkdown | 置換 |
| `polish` | 選択範囲 | 修正文 | 置換 |
| `extract_tasks` | 選択範囲または本文 | `- [ ]` 形式のTODO | 挿入 |
| `suggest_tags` | 本文 | タグ配列または箇条書き | 表示後、手動反映 |
| `append_summary` | 本文 | `## まとめ` セクション | 末尾に挿入 |

## 7. API設計

### 7.1 `GET /api/ai/status`

LLM サーバーへの接続確認を行う。

#### Response

```json
{
  "ok": true,
  "provider": "ollama",
  "model": "qwen2.5:1.5b"
}
```

失敗時:

```json
{
  "ok": false,
  "provider": "ollama",
  "model": "qwen2.5:1.5b",
  "message": "Ollama に接続できません。ollama serve が起動しているか確認してください。"
}
```

### 7.2 `POST /api/ai/action`

ノート編集用のAI操作を実行する。

#### Request

```json
{
  "action": "summarize",
  "filePath": "3年生/春/パターン認識/01_パターン認識の概要と最近傍法.md",
  "content": "# パターン認識...",
  "selection": "最近傍法は...",
  "language": "ja"
}
```

#### Request fields

| フィールド | 必須 | 説明 |
| --- | --- | --- |
| `action` | 必須 | 実行するAI操作 |
| `filePath` | 必須 | 対象ノートの `NOTES_DIR` 相対パス |
| `content` | 必須 | 現在エディタ上の全文 |
| `selection` | 任意 | 選択範囲。未指定時は本文を使う |
| `language` | 任意 | 初期値は `ja` |

#### Response

```json
{
  "action": "summarize",
  "result": "## 要約\n\n- ...",
  "applyMode": "insert"
}
```

#### `applyMode`

| 値 | 説明 |
| --- | --- |
| `insert` | カーソル位置に挿入 |
| `replace_selection` | 選択範囲を置換 |
| `append` | ノート末尾へ追加 |
| `display_only` | 結果表示のみ |

## 8. UI設計

### 8.1 配置

`EditorPane.svelte` のヘッダー右側に AI メニューを追加する。

候補:

- アイコンボタン: `Sparkles`
- ドロップダウンメニュー
- 実行中は `Loader2`
- 接続失敗時は `AlertCircle`

既存のエディタヘッダーは行数・文字数・画像貼り付け状態を表示しているため、AI 操作はコンパクトなメニューにまとめる。

### 8.2 メニュー項目

- 要約を挿入
- 箇条書きに整形
- 文章を整える
- TODOを抽出
- タグを提案
- まとめを末尾に追加

### 8.3 結果確認UI

AIの結果は即時反映しない。小さな確認パネルまたはモーダルで表示する。

操作:

- `挿入`
- `置換`
- `末尾に追加`
- `閉じる`

アクションごとに既定の反映方法を選ぶが、最終操作はユーザーが明示的に行う。

### 8.4 エラー表示

LLM が利用できない場合は、エディタ内に以下のような短いメッセージを表示する。

```txt
Ollama に接続できません。Ollama を起動し、モデル qwen2.5:1.5b が取得済みか確認してください。
```

## 9. プロンプト設計

### 9.1 共通 system prompt

```txt
あなたは大学授業ノートの編集を補助するアシスタントです。
回答は日本語で書いてください。
Markdown構造を保ち、元の情報にない事実を追加しないでください。
内容が不明な場合は推測せず、不明と書いてください。
出力本文だけを返してください。
```

### 9.2 要約

```txt
次の授業ノートを、復習しやすいMarkdownの箇条書きで要約してください。
重要語、定義、式、授業中の注意点を優先してください。
```

### 9.3 箇条書き整形

```txt
次の文章を、意味を変えずにMarkdownの箇条書きへ整理してください。
階層が必要な場合は2スペースインデントを使ってください。
```

### 9.4 文章修正

```txt
次の文章を、授業ノートとして自然で読みやすい日本語に整えてください。
専門用語、式、固有名詞はできるだけ維持してください。
```

### 9.5 TODO抽出

```txt
次の授業ノートから、学生が後で行うべき作業を抽出してください。
出力はMarkdownのチェックボックスだけにしてください。
期限が明記されている場合は 📅YYYY-MM-DD を付けてください。
```

### 9.6 タグ提案

```txt
次の授業ノートに付けるタグを3から8個提案してください。
出力はタグ名だけをMarkdownの箇条書きで返してください。
```

## 10. 入力制限

軽量モデルでは長文をそのまま渡すと遅くなるため、MVPでは以下の制限を設ける。

- 選択範囲がある場合は選択範囲を優先する。
- 本文全体を使う場合は最大 12,000 文字までに制限する。
- `append_summary` と `suggest_tags` は先頭・見出し・末尾を優先して圧縮する。
- 制限を超える場合、UI に「長いノートのため一部だけを使いました」と表示する。

将来的にはチャンク分割とRAG検索で長文対応する。

## 11. セキュリティと安全性

### 11.1 ファイルアクセス

- AI API は `filePath` を受け取るが、MVPではファイルを直接読み書きしない。
- 送信される本文はエディタ上の `content` を使う。
- 将来サーバー側でファイルを読む場合は、既存の `resolveSafePath` を必ず使う。

### 11.2 書き込み

- LLMの出力をサーバー側で直接ファイルに書き込まない。
- 反映はエディタ上のテキスト操作として行い、既存の自動保存フローに乗せる。
- ユーザー確認なしにノートを変更しない。

### 11.3 プライバシー

- 初期実装ではローカルLLMサーバーのみを呼び出す。
- 外部APIプロバイダは実装しない。
- 将来クラウドLLMを追加する場合は、明示的な設定と警告表示を必須にする。

## 12. RAG拡張設計

MVPが安定した後、ノート横断検索を追加する。

### 12.1 インデックス

保存先:

```txt
<NOTES_DIR>/.mnm/ai-index.json
```

初期は JSON で十分。ノート数が増えて遅くなった場合は SQLite へ移行する。

### 12.2 チャンク単位

- Markdown見出し単位を優先する。
- 見出しが長すぎる場合は 800 から 1,200 文字程度で分割する。
- チャンクには `filePath`, `heading`, `text`, `embedding`, `updatedAt` を持たせる。

### 12.3 更新タイミング

初期は手動更新のみ。

- ホームまたは設定画面に「AI検索インデックスを更新」ボタンを置く。
- 将来的に保存後の差分更新を追加する。

### 12.4 RAG API

```txt
POST /api/ai/index
POST /api/ai/chat
```

`/api/ai/chat` は質問に関連するチャンクを検索し、出典ノートを添えて回答する。

## 13. 実装フェーズ

### Phase 1: LLM接続基盤

タスク:

- `.env.example` に LLM 設定を追加
- `src/lib/server/llm/config.ts` を追加
- `provider.ts` / `ollama.ts` を追加
- `GET /api/ai/status` を追加

完了条件:

- Ollama 起動中に status API が `ok: true` を返す
- Ollama 未起動時に日本語エラーを返す

### Phase 2: AIアクションAPI

タスク:

- `prompts.ts` を追加
- `actions.ts` を追加
- `POST /api/ai/action` を追加
- 入力文字数制限とアクション検証を実装

完了条件:

- `summarize`, `bulletize`, `polish` が API 経由で動く
- 長文入力時もタイムアウトや過剰送信で破綻しない

### Phase 3: エディタUI

タスク:

- `EditorPane.svelte` に AI メニューを追加
- 選択範囲を取得できるようにする
- AI結果確認UIを追加
- 挿入・置換・末尾追加を実装

完了条件:

- 選択範囲の要約を挿入できる
- 選択範囲を箇条書きへ置換できる
- 失敗時にエディタが壊れない

### Phase 4: ノート向け補助機能

タスク:

- TODO抽出
- タグ提案
- まとめ末尾追加

完了条件:

- TODO が既存の `TaskDashboard` で拾える `- [ ]` 形式になる
- タグ提案は自動反映せず、コピーまたは手動挿入できる

### Phase 5: RAG

タスク:

- `nomic-embed-text` 対応
- Markdownチャンク化
- `.mnm/ai-index.json` 作成
- ノート横断質問API
- 出典付き回答UI

完了条件:

- 科目フォルダ内の過去ノートを根拠に質問応答できる
- 回答に参照元ノートが表示される

## 14. テスト方針

### 14.1 単体テスト相当

現状のプロジェクトには単体テスト基盤がないため、まずは以下を `npm run check` と API の手動確認で担保する。

- action のバリデーション
- prompt 生成
- LLM未起動時のエラー
- タイムアウト

### 14.2 E2E

Playwright で以下を追加する。

- AIボタンが表示される
- LLM未設定または未起動時にエラー表示される
- モック可能なら `/api/ai/action` を差し替えて挿入・置換操作を確認する

実モデルを使う E2E は環境差が大きいため、通常CIには含めない。

## 15. 運用手順

ユーザー向けには README に以下を追記する。

```bash
ollama pull qwen2.5:1.5b
ollama serve
```

動作確認:

```bash
curl http://localhost:11434/api/chat \
  -d '{
    "model": "qwen2.5:1.5b",
    "messages": [{"role": "user", "content": "日本語で短く自己紹介して"}],
    "stream": false
  }'
```

## 16. 採用判断

初期実装では以下を採用する。

- Ollama
- `qwen2.5:1.5b`
- 非ストリーミング生成
- エディタ選択範囲ベースのAI操作
- ユーザー確認後の手動反映

初期実装では以下を見送る。

- 自動ファイル書き換え
- 画像理解
- クラウドLLM
- 常時RAGインデックス更新
- 複雑なエージェント機能

この方針により、ローカル・無料・軽量という条件を満たしながら、授業ノート編集で実用的なAI補助を段階的に追加できる。
