"use client";

import { useLayoutEffect } from "react";
import { ACTIVITY_COLORS, activityColor, activityKey } from "./activity-colors";

const CANDIDATE_SELECTOR = [
  "article",
  "button",
  "tr",
  "[class*='prodStrip'] > div",
  "[class*='productionGrid'] > article",
  "[class*='sectorGrid'] > button",
  "[class*='sector-grid'] > button",
  "[class*='flowCard']",
].join(",");

function shortText(node: Element | null) {
  const value = node?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  return value.length <= 80 ? value : "";
}

function activityLabel(element: HTMLElement) {
  const candidates = [
    element.getAttribute("data-activity") ?? "",
    element.tagName === "BUTTON" ? shortText(element) : "",
    shortText(element.querySelector(":scope > span")),
    shortText(element.querySelector(":scope > h3")),
    shortText(element.querySelector(":scope > header span")),
    shortText(element.querySelector(":scope > div > span")),
    shortText(element.querySelector("td:first-child strong")),
    shortText(element.querySelector("td:first-child")),
  ].filter(Boolean);
  return candidates.find((value) => activityKey(value)) ?? "";
}

function applyActivityColor(element: HTMLElement) {
  if (element.closest("nav,.hsm,.gn-drawer,.sidebar,.crvo-auth-nav")) return;
  const label = activityLabel(element);
  const key = activityKey(label);
  if (!key) return;
  const color = activityColor(label);

  element.dataset.crvoActivity = key;
  element.style.setProperty("--crvo-activity-color", color);
  element.style.setProperty("--sector-color", color);

  if (element.tagName === "TR") {
    const firstCell = element.querySelector<HTMLElement>("td:first-child");
    if (firstCell) firstCell.style.boxShadow = `inset 4px 0 0 ${color}`;
  } else {
    element.style.borderTopColor = color;
    element.style.borderTopStyle = "solid";
    element.style.borderTopWidth = "4px";
  }

  element.querySelectorAll<HTMLElement>("i > b,[class*='bar'] > i,[class*='Bar'] > i,[class*='progress'] > i,[class*='Progress'] > i,[class*='track'] > i,[class*='Track'] > i")
    .forEach((bar) => { bar.style.backgroundColor = color; });
}

function paint(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>(CANDIDATE_SELECTOR).forEach(applyActivityColor);
}

export default function ActivityColorBinder() {
  useLayoutEffect(() => {
    let frame = 0;
    const schedule = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => paint());
    };
    paint();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return <style>{`
    :root{
      --activity-expertise:${ACTIVITY_COLORS.expertise};
      --activity-mecanique:${ACTIVITY_COLORS.mecanique};
      --activity-jantes:${ACTIVITY_COLORS.jantes};
      --activity-carrosserie:${ACTIVITY_COLORS.carrosserie};
      --activity-dsp:${ACTIVITY_COLORS.dsp};
      --activity-preparation:${ACTIVITY_COLORS.preparation};
      --activity-qualite-photo:${ACTIVITY_COLORS.qualitePhoto};
      --activity-sortie-usine:${ACTIVITY_COLORS.sortieUsine};
    }
    [data-crvo-activity]{transition:border-color .16s ease}
  `}</style>;
}
