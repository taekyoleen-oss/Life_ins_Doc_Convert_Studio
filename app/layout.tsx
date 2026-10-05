import type { Metadata } from "next";
import localFont from "next/font/local";
import "katex/dist/katex.min.css";
import "./globals.css";

// 글꼴은 모두 저장소에 둔다(OFL) — next/font/google 은 빌드 때 Google 에서 받아 오는데, Vercel 빌드에서 Google 이 준 새 주소 형식을
// Turbopack 이 못 읽어 배포가 깨졌다(2026-10-05 "next/font/google queries have exactly one entry")
const fraunces = localFont({ variable: "--font-fraunces", display: "swap", src: [
  { path: "../public/fonts/fraunces-latin-600-normal.woff2", weight: "600" },
  { path: "../public/fonts/fraunces-latin-700-normal.woff2", weight: "700" },
] });
const jetbrains = localFont({ src: "../public/fonts/jetbrains-mono-latin-wght-normal.woff2", variable: "--font-jetbrains", weight: "100 800", display: "swap" });
const pretendard = localFont({ src: "../public/fonts/PretendardVariable.woff2", variable: "--font-pretendard", weight: "45 920", display: "swap" });

export const metadata: Metadata = {
  title: "Life_ins_Doc_Convert_Studio — 산출방법서 ↔ 조건 변환기",
  description: "조건(YAML·MethodSpec)을 입력하면 산출방법서가, 산출방법서(PDF·HWP·DOCX·LaTeX)를 넣으면 조건이 만들어집니다.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className={`${fraunces.variable} ${jetbrains.variable} ${pretendard.variable} antialiased`}>{children}</body>
    </html>
  );
}
