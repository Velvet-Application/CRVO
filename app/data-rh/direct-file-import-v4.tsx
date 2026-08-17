"use client";

import DirectFileImportV3 from "./direct-file-import-v3";
import StrictBilledTimeImport from "./strict-billed-time-import";
import styles from "./data-rh.module.css";

export default function DirectFileImportV4(){
  return <>
    <StrictBilledTimeImport />
    <div className={styles.legacyImports}>
      <DirectFileImportV3 />
    </div>
  </>;
}
