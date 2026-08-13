"use client";

import { useEffect } from "react";
import LiveBottlenecksPatch from "./live-bottlenecks-patch";

function replaceLegacySftpLabels(root: unknown) {
  const walker = document.createTreeWalker(root as unknown as Node, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    if (current.nodeValue?.includes("SFTP")) nodes.push(current as Text);
    current = walker.nextNode();
  }
  for (const node of nodes) node.nodeValue = node.nodeValue?.replaceAll("SFTP", "FTP") ?? node.nodeValue;
}

export default function FtpTerminologyPatch() {
  useEffect(() => {
    replaceLegacySftpLabels(document.body);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.TEXT_NODE && node.nodeValue?.includes("SFTP")) {
            node.nodeValue = node.nodeValue.replaceAll("SFTP", "FTP");
          } else if (node instanceof HTMLElement) {
            replaceLegacySftpLabels(node);
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return <LiveBottlenecksPatch />;
}
