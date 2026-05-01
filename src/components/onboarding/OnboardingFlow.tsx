import { useRef, useState } from 'react';
import { Stage, type StageHandle } from './Stage';
import { Welcome } from './scenes/Welcome';
import { ConnectGitHub } from './scenes/ConnectGitHub';
import { ImportStars } from './scenes/ImportStars';
import { Done } from './scenes/Done';
import {
  CONNECT_IDLE, CONNECT_VALIDATED,
  IMPORT_PEAK, IMPORT_CALMED, DONE as DONE_PRESET,
  type SceneParams,
} from '../../lib/orbScenes';

export type OnboardingCompleteOpts = {
  openAddModal?: boolean;
};

type Step = 1 | 2 | 3 | 4;

export function OnboardingFlow({
  onComplete,
}: {
  onComplete: (opts: OnboardingCompleteOpts) => void;
}) {
  const stageRef = useRef<StageHandle>(null);
  const [step, setStep] = useState<Step>(1);

  function setSceneSafe(target: SceneParams, transitionMs?: number) {
    stageRef.current?.engine?.setScene(target, transitionMs);
  }
  function spawnSafe(n: number) {
    stageRef.current?.engine?.spawn(n);
  }

  // Initial scene = WELCOME (set on engine attach via OrbEngine default)

  function goToStep2() {
    setSceneSafe(CONNECT_IDLE, 600);
    setStep(2);
  }

  async function goToStep3() {
    // Burst on validation success
    setSceneSafe(CONNECT_VALIDATED, 400);
    spawnSafe(4);
    await new Promise(r => setTimeout(r, 800));
    setSceneSafe(IMPORT_PEAK, 600);
    setStep(3);
  }

  function goToStep4() {
    setSceneSafe(DONE_PRESET, 800);
    setStep(4);
  }

  function calmImport() {
    setSceneSafe(IMPORT_CALMED, 800);
  }

  function exitToManual() {
    onComplete({ openAddModal: true });
  }

  function exitToLibrary() {
    onComplete({});
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-bg">
      {/* Traffic-light spacer for macOS */}
      <div data-tauri-drag-region className="flex-shrink-0 h-8" />

      <main className="flex-1 flex flex-col items-center justify-center px-6">
        <div className="mb-10">
          <Stage ref={stageRef} />
        </div>
        <div className="w-full max-w-md">
          {step === 1 && <Welcome onContinue={goToStep2} />}
          {step === 2 && (
            <ConnectGitHub
              onValidated={goToStep3}
              onSkipToManual={exitToManual}
              onSpawn={spawnSafe}
            />
          )}
          {step === 3 && (
            <ImportStars
              onSpawn={spawnSafe}
              onCalm={calmImport}
              onContinue={goToStep4}
            />
          )}
          {step === 4 && <Done onContinue={exitToLibrary} />}
        </div>
      </main>
    </div>
  );
}
