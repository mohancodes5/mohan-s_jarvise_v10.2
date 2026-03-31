import type { AppProps } from "next/app";
import { Inter, JetBrains_Mono } from "next/font/google";
import Head from "next/head";
import "../styles/globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <title>Assistant</title>
        <meta
          name="description"
          content="AI chat — OpenAI, Claude, or local Ollama"
        />
      </Head>
      <div
        className={`${inter.variable} ${jetbrains.variable} min-h-full touch-manipulation font-sans antialiased`}
      >
        <Component {...pageProps} />
      </div>
    </>
  );
}
