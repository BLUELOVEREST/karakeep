"use client";

import React from "react";
import { useState } from "react";

export default function BookmarkFavicon({ src }: { src: string }) {
  const [hidden, setHidden] = useState(false);

  if (hidden) {
    return null;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt="favicon"
      className="size-5"
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setHidden(true)}
    />
  );
}
