"use client";

import { useEffect } from "react";

const OPTIONAL_ARCHIVE_LIMIT = 25 * 1024 * 1024;

export default function UploadArchiveGuard() {
  useEffect(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const body = init?.body;
      const isSignedStorageUpload = init?.method?.toUpperCase() === "PUT"
        && /\/storage\/v1\/object\/upload\/sign\//.test(url)
        && body instanceof Blob;

      if (isSignedStorageUpload && body.size > OPTIONAL_ARCHIVE_LIMIT) {
        return new Response(null, {
          status: 204,
          headers: { "x-crvo-archive": "skipped-large-file" },
        });
      }

      return nativeFetch(input, init);
    };

    return () => { window.fetch = nativeFetch; };
  }, []);

  return null;
}
