import { headers } from "next/headers";
import { LotusMark } from "@/components/brand";
import { IntroController } from "./intro-controller";

/**
 * The opening (once per browser session): the lotus blooms petal by petal, the name writes in, then
 * the logo glides into its place in the header as the page comes up.
 *
 * It is in the first HTML, so there is no flash of the page before it. A small script in <head>
 * (with this request's CSP nonce) decides before the first paint whether it plays: not again in the
 * same session, not for automated browsers (the browser checks), and calmly for reduced motion.
 * Without JavaScript nothing shows. Tap anywhere to skip.
 */
// A tap or key before the app's code has loaded is remembered (window.__ttSkip), so skipping works at once.
export const INTRO_SCRIPT = `try{var d=document.documentElement,s=sessionStorage;if(!s.getItem("tt-intro")&&!(navigator.webdriver&&!window.__ttForceIntro)){d.classList.add("tt-intro");s.setItem("tt-intro","1");var k=function(){window.__ttSkip=1;window.dispatchEvent(new Event("tt-intro-skip"))};addEventListener("pointerdown",k,{once:true,capture:true});addEventListener("keydown",k,{once:true,capture:true})}}catch(e){}`;

export async function IntroScript() {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: INTRO_SCRIPT }} />;
}

export function IntroSplash() {
  return (
    <div id="tt-intro" aria-hidden="true" className="tt-intro-overlay">
      <div className="tt-intro-glow" />
      <div className="tt-intro-stage">
        <span className="tt-intro-badge">
          <LotusMark width={132} bloom title="" />
        </span>
        <span className="tt-intro-name font-condensed">Taamara Taamara</span>
        <span className="tt-intro-tag">events &amp; beyond</span>
        <span className="tt-intro-line rainbow" />
      </div>
      <IntroController />
    </div>
  );
}
