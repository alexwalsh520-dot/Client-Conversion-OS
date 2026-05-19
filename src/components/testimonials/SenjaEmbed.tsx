"use client";

/**
 * Senja widget embed for the public testimonials page.
 *
 * Senja's widget JS is loaded via next/script with afterInteractive
 * strategy so it doesn't block the page render. The mount div uses
 * data-mode="shadow" so the widget's styles are isolated from the
 * surrounding CCOS dark-mode CSS.
 */

import Script from "next/script";

const WIDGET_ID = "07bee554-fb73-4559-844f-dc2bdaa84980";

export default function SenjaEmbed() {
  return (
    <>
      <Script
        src={`https://widget.senja.io/widget/${WIDGET_ID}/platform.js`}
        strategy="afterInteractive"
      />
      <div
        className="senja-embed"
        data-id={WIDGET_ID}
        data-mode="shadow"
        data-lazyload="false"
        style={{ display: "block", width: "100%" }}
      />
    </>
  );
}
