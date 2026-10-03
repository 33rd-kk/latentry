# Latentry

手元で動かしている画像生成モデルのための Web UI です。text-to-image・img2img・インペイント・ポーズ指定を 1 つのフォームから行えます。複数のバックエンドを同時に扱え、たとえば Anima のサーバーと SDXL の Web UI を並べて、それぞれ別の設定で使えます。どの画像がどう作られたかを把握しているギャラリーと、WD14 タグの抽出・書き戻しも付いています。

[English](README.md)

## できること

- **生成**：text-to-image、img2img（差分・修正、またはポーズ参照）、マスクを塗るインペイント、骨格ポーズ指定（対応バックエンドのみ）。生成はサーバー側で進むので、再読み込みしたり別タブで開いたりしても、実行中の生成をそのまま表示できます。
- **複数のバックエンドとモデル系統**：フォームはバックエンドごとに保存されます。*プロファイル*（Anima / SDXL / Illustrious・NoobAI / Pony / 汎用）がサイズ・ステップ数・CFG・ネガティブ・アーティスト表記・品質タグの初期値を決めます。プロファイルはいつでも切り替えられます。
- **ギャラリー**：生成した画像はすべて設定を埋め込んで保存します（A1111 の PNG Info でも読めます）。ComfyUI や Web UI の出力フォルダも読み取り専用で閲覧でき、そのメタデータも読みます。検索、バックエンドやプロファイルでの絞り込みができ、設定・タグ・画像そのものをフォームに送れます。
- **タグ**：元画像から WD14 タグを抽出し、髪・目・服装などのグループ単位でキャラの見た目をプロンプトに持ち込めます。ギャラリーの画像にタグを付けて、ファイルに保存することもできます。
- 日本語と英語、ライトとダーク。シークレットモードでは入力内容をブラウザに保存せず、ギャラリーの画像をぼかします。

## バックエンド

| 種類 | 対象 | 備考 |
|---|---|---|
| `diffusers` | [docs/backend-api.md](docs/backend-api.md) の小さな HTTP API を話すサーバー | img2img・インペイント・ポーズ（サーバーが対応していれば）・WD14・個別キャンセル |
| `a1111` | `--api` 付きで起動した AUTOMATIC1111 / Forge | img2img・インペイント・WD14（tagger 拡張が必要）。ポーズ指定は非対応 |

Latentry 自体はモデルサーバーを同梱していません。お好みのものを起動して、設定に列挙してください。

## はじめかた

Node.js 22.12 以上が必要です。

```bash
git clone <このリポジトリ> latentry
cd latentry
npm ci
cp .env.example .env.local   # 編集する
npm run dev                  # http://localhost:3000
```

最小の `.env.local`：

```bash
GEN_BACKENDS=sdxl|a1111|http://localhost:7860|illustrious
GALLERY_SAVE_DIR=./output
```

バックエンドが 2 つで、片方に認証がある場合：

```bash
GEN_BACKENDS=anima|diffusers|http://localhost:7865|anima;sdxl|a1111|http://localhost:7860|illustrious
GEN_TOKEN_SDXL=user:password
GALLERY_SAVE_DIR=D:\pictures\latentry
GALLERY_DIRS=D:\ComfyUI\output
```

各変数の説明は [.env.example](.env.example) にあります。普段使いでは `npm run build && npm start` のほうが開発サーバーより軽快です。

## 注意点

- **ギャラリーが読むのは、Latentry を動かしているマシン上のフォルダです。** バックエンドはネットワーク上の別マシンでも構いませんが、`GALLERY_SAVE_DIR` と `GALLERY_DIRS` はローカル（またはマウントした共有フォルダ）である必要があります。フォルダは `.env.local` でのみ設定でき、ブラウザからは変更できません。
- **バックエンドも画像を保存する場合、画像は二重に残ります。** 設定が埋め込まれているのは Latentry 側のコピーです。不要ならバックエンド側の保存を止めてください。
- **生成は 1 バックエンドにつき同時に 1 本です。** 別のバックエンドとは並行して動かせます。
- **自分のマシンか LAN 内で使う前提です。** `/api` は `localhost` とプライベートネットワークのアドレスにしか応答せず（ほかを許可するには `ALLOWED_HOSTS`）、クロスサイトのリクエストを拒否し、IP ごとにリクエスト数を制限します。ログイン機能はありません。外部に公開する場合は、認証付きで、かつ `X-Forwarded-For` を上書きするリバースプロキシを前に置いてください（IP ごとの制限はこのヘッダーを信用します）。

## 開発

```bash
npm run typecheck
npm run lint
npm test              # __tests__/ の verify スクリプト（テストフレームワーク不要）
npm test -- gallery   # 名前に "gallery" を含むものだけ
```

構成：

- `lib/backends/`：バックエンドのアダプタ（`diffusers.ts`・`a1111.ts`）と共通インターフェイス
- `lib/profiles/`：モデルプロファイルとプロンプトの組み立て
- `lib/diffusion/job-store.ts`：バックエンドごとに 1 本の実行中ジョブ
- `lib/gallery/`：PNG メタデータ、保存、フォルダへのアクセス
- `app/api/gen/*`・`app/api/gallery/*`：ページが呼ぶ API
- `components/generate/`・`components/gallery/`：2 つのページ

## ライセンス

[MIT](LICENSE)
