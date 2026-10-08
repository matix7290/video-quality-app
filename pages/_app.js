import { appWithTranslation } from "next-i18next";
import "@/public/study-theme.css";
import "@/styles/globals.css";

function MyApp({ Component, pageProps }) {
  return <Component {...pageProps} />;
}

export default appWithTranslation(MyApp);
