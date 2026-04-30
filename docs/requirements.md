# **授業ノート管理アプリ 要件定義・詳細設計書 (PRD & System Architecture)**

## **1\. プロジェクト概要 (Overview)**

大学の授業ノート（Markdown形式）をローカル環境で快適に編集し、授業終了時にGitHubへ一元管理するための専用Webアプリケーション。 ローカルのディレクトリツリーをそのままUIに反映し、WYSIWYGライクなリアルタイムプレビュー、画像ペースト時の自動保存機能、Smart Frontmatter（メタデータ自動補完）、時間割・課題ダッシュボード、およびGit連携を提供する。

## **2\. ユーザーストーリー (User Stories)**

AIは以下のUXを実現するようにUI/コンポーネントを設計すること。

1. **\[Dashboard\]** アプリ起動時、ユーザーはホーム画面で「今日の時間割」と「未完了の課題(TODO)一覧」を一目で確認できる。  
2. **\[Create\]** 時間割のコマ、または左ペインの科目フォルダ横の「＋」を押すと、今日の日付と前回のノート情報（教室など）が自動入力された新規作成モーダルが開き、即座にタイピングを開始できる。  
3. **\[Edit\]** ノート記述中、\-  や Tab で箇条書きを素早く構成でき、スクショを Cmd+V で貼り付けると即座にプレビューの指定位置に画像が表示される。  
4. **\[Auto-Save\]** ユーザーが保存を意識しなくても、入力停止後一定時間でバックグラウンド保存される。  
5. **\[Sync\]** 授業終了時、ヘッダーの「Push」ボタンを1クリックするだけで、適切なコミットメッセージと共にGitHubへ同期される。

## **3\. システム要件・技術スタック (System Requirements)**

* **分離配置**: SvelteKitアプリとノート保存先（Gitリポジトリ）は分離する。  
* **データソース**: .env で指定された NOTES\_DIR (絶対パス) のローカルファイルシステム。  
* **前提条件**: NOTES\_DIR は既に git init されリモート設定済みであること。  
* **技術スタック**:  
  * フレームワーク: SvelteKit (Svelte 5 Runes $state, $derived 活用)  
  * 言語: TypeScript (Strict mode)  
  * スタイリング: Tailwind CSS, @tailwindcss/typography (prose), shadcn-svelte  
  * バックエンド: Node.js fs/promises, simple-git  
  * パッケージ: marked, KaTeX, Shiki, gray-matter

## **4\. データスキーマ・規則 (Data Schema)**

### **4.1 ファイル命名規則**

* Markdownファイル: ^(\\d{2})\_(.+)\\.md$ （例: 01\_パターン認識.md）

### **4.2 型定義 (TypeScript Interfaces)**

AIは以下の型定義をベースに状態管理とAPIを実装すること。

// Frontmatter (gray-matterでパースされるメタデータ)  
interface NoteFrontmatter {  
  title: string;       // 必須  
  date: string;        // 必須 (YYYY-MM-DD)  
  location?: string;   // 任意  
  slide\_url?: string;  // 任意  
  tags?: string\[\];     // 任意  
}

// 時間割データ (timetable.json)  
interface Timetable {  
  \[dayOfWeek: string\]: {  
    \[period: string\]: {  
      subject: string;  
      directory: string; // NOTES\_DIRからの相対パス (例: "3年生/春/パターン認識")  
    }  
  }  
}

// 自動抽出された課題 (TODO)  
interface TaskItem {  
  id: string;  
  filePath: string;    // どのノートか  
  subject: string;     // 科目名  
  content: string;     // タスク内容  
  isCompleted: boolean;  
}

## **5\. アプリケーション・アーキテクチャ (Architecture)**

### **5.1 コンポーネントツリー**

src/  
 ├── routes/+layout.svelte (Header: パンくず, Pushボタン / Sidebar: FileTree)  
 ├── routes/+page.svelte (Home)  
 │    ├── DashboardStats (統計情報)  
 │    ├── TaskDashboard (TaskList表示)  
 │    └── TimetableGrid (時間割表示・登録UI)  
 └── routes/note/\[...path\]/+page.svelte (Editor View)  
      ├── EditorPane (TextArea, Frontmatter UI, onPaste/onDrop)  
      └── PreviewPane (HTML Rendered with Tailwind Typography, KaTeX, Shiki)

### **5.2 APIエンドポイント仕様 (Backend API)**

* GET /api/tree \=\> NOTES\_DIR のディレクトリ構造をJSONで返す。  
* GET /api/file?path=... \=\> 指定ファイルの生テキストを返す。  
* POST /api/file \=\> { path, content } を受け取り上書き保存。  
* POST /api/images/upload \=\> FormData(image, targetPath)を受け取り、targetPath同階層の images/ に保存。保存先ファイル名を返す。  
* GET /api/images/\[...path\] \=\> NOTES\_DIR 内の画像をバイナリ配信 (プレビュー用)。  
* GET /api/timetable / POST /api/timetable \=\> timetable.json のCRUD。  
* GET /api/tasks \=\> 全 .md を走査し、\- \[ \] または \- \[x\] の行を TaskItem\[\] として返す。  
* POST /api/git/push \=\> simple-git で git add ., git commit \-m "\[科目名\]\_\[連番\]\_\[ノート名\]", git push を実行。

## **6\. コア機能・UI要件 (Core Features & UI constraints)**

### **6.1 UIレイアウト・レスポンシブ要件**

* **大画面表示**: 左ペイン(Sidebar) 10% : 中央(Editor) 45% : 右ペイン(Preview) 45% の Split View。  
* Sidebarはトグルで折りたたみ可能とし、閉鎖時は Editor 50% : Preview 50% とする。  
* **モバイル/小画面**: EditorとPreviewをタブで切り替えるUIにフォールバックすること。  
* Markdownプレビュー領域は、深くネストされた箇条書き（ul \> li）が見やすいよう @tailwindcss/typography を調整すること。

### **6.2 エディタの挙動**

* **スクロール同期**: EditorとPreviewのスクロール位置を同期させる。  
* **自動保存**: 入力停止から一定時間（例: 30秒）経過、または Cmd/Ctrl \+ S で自動保存APIを発火。  
* **画像ペースト**: onPaste / onDrop でBlobを取得し /api/images/upload へ送信。成功後カーソル位置に \!\[image\](./images/xxx.png) を挿入。  
* プレビュー時の画像パスは、自動で /api/images/\[...path\] を向くようレンダラーをオーバーライドすること。

### **6.3 Smart Frontmatter (メタデータ自動補完)**

新規作成時、以下のロジックで自動入力を行う：

1. 対象フォルダの最新ノート（最大連番）を特定。  
2. 連番を+1し、必ず2桁ゼロ埋め（例:03）でファイル名を生成。  
3. date は本日の日付(YYYY-MM-DD)。location等は前回のFrontmatterから引き継ぐ。slide\_urlは引き継がず空にする。

## **7\. AI向け 実装フェーズ (Implementation Phases)**

Vibecodingの際は、以下のフェーズ順に実装し、各フェーズの「完了条件」を満たしてから次へ進むこと。

* **Phase 1: 基盤構築とツリー表示**  
  * **タスク**: SvelteKit初期化、Tailwind/shadcn設定。.env設定。/api/tree と /api/file の実装。SidebarのUI実装。  
  * **完了条件**: アプリを起動し、Sidebarにローカルのノートディレクトリ階層が正しく表示されること。  
* **Phase 2: エディタとプレビュー**  
  * **タスク**: EditorPaneとPreviewPaneの実装。marked, KaTeX, Shiki の統合。画像配信API (GET /api/images/\[...path\]) の実装。  
  * **完了条件**: 左でマークダウンを記述すると右にリアルタイムで装飾表示され、ローカル画像も正しく表示されること。  
* **Phase 3: 自動保存と画像ペースト**  
  * **タスク**: デバウンス付き自動保存ロジック。/api/images/upload の実装。onPaste/onDrop フックの実装。  
  * **完了条件**: スクロール同期が動き、スクショのペースト一発でローカルに画像が保存されマークダウンに反映されること。  
* **Phase 4: ダッシュボード・時間割・タスク抽出**  
  * **タスク**: ホーム画面の実装。timetable.json 用APIとUI。/api/tasks の実装（全ファイル走査によるTODO抽出）。  
  * **完了条件**: 時間割に科目が登録でき、ノート内の \- \[ \] がホーム画面のダッシュボードに一覧表示されること。  
* **Phase 5: Smart Frontmatter と Git同期**  
  * **タスク**: gray-matter によるメタデータ継承と連番自動インクリメント機能（新規作成モーダル）。/api/git/push の実装。  
  * **完了条件**: ボタン1つで適切なファイル名の新規ノートが作成でき、授業終了時にPushボタンでGitHub同期が完了すること。最後にセットアップ手順を README.md に出力すること。