import type { Metadata } from "next";
import { Fraunces, JetBrains_Mono } from "next/font/google";
import localFont from "next/font/local";
import "katex/dist/katex.min.css";
import "./globals.css";

const fraunces = Fraunces({ variable: "--font-fraunces", subsets: ["latin"], weight: ["600", "700"] });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });
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
