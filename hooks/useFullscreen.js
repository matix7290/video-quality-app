import { useEffect, useState } from "react";

export default function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const check = () => setIsFullscreen(document.fullscreenElement != null);
    document.addEventListener("fullscreenchange", check);
    check();
    return () => document.removeEventListener("fullscreenchange", check);
  }, []);

  return { isFullscreen };
}
