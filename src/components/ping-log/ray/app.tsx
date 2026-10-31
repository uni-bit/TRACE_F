"use client";

import { useState } from "react";

import type { Consent } from "@/lib/ping-log/consent";
import { entryCheck, type EntryCheck, type PushSupport } from "@/lib/ping-log/environment";
import type { Shot } from "@/lib/ping-log/photo-entry";
import type { LogEntry, SaveOutcome } from "@/lib/ping-log/store";
import { reducedMotion } from "@/lib/ray/fx";

import { ArrivalFlow, type ArrivalTarget } from "./arrival";
import { DemoFlow } from "./demo";
import { ConsentLayer, DeletePhotoLayer, HowToLayer, InstallLayer, MenuLayer, StopLayer, WithdrawLayer, type MenuItem, type OverlayName } from "./overlays";
import { PhotoScreen } from "./photo";
import { ConsentScreen, HomeScreen, PingScreen, SkipScreen, TitleScreen, type ReminderTerms } from "./screens";
import { RayStage, SWAP, useRay } from "./stage";

import "./ray.css";

/**
 * The participant's side of /log in ShibaLab's RAY look. Everything it does
 * comes from PingLogScreen through these props; this file only decides which
 * screen is up and how one gives way to the next.
 */

export type RayAppProps = {
  joined: boolean;
  ended: boolean;
  onStop?: () => Promise<string | null>;
  consent: Consent | null;
  consentTerms: { version: string; language: string; body: string } | null;
  /** The consent screen before joining. */
  consentOpen: boolean;
  onOpenConsent: () => void;
  onCloseConsent: () => void;
  onAgree: () => Promise<void>;
  joining: boolean;
  joinError: string;
  /** Notes for the top of the title or home screen. */
  notes: string[];
  busy: boolean;
  support: PushSupport;
  /** This participation's photos, oldest first. */
  photos: LogEntry[];
  maxPhotos: number;
  pendingAt: string | null;
  /** The reminder opened the page, or arrived while it was open: its own screen. */
  pingOpen: boolean;
  onClosePing: () => void;
  reminderOn: boolean;
  nextReminderAt: number | null;
  reminderTerms: ReminderTerms;
  onReminder: (on: boolean) => Promise<string | null>;
  onReminderInterval: (minutes: number) => Promise<string | null>;
  shot: Shot | null;
  onRetake: () => void;
  onSave: (entry: LogEntry) => Promise<SaveOutcome>;
  onCloseShot: () => void;
  /** When the skipped reminder was due, while its clear screen is up. */
  skipped: string | null;
  onCloseSkip: () => void;
  /** Where the arrival demo was opened from, while it is up. */
  demo: "home" | "developer" | null;
  /** The retained experience; home's QR button reads the booth's real code. */
  arrival: ArrivalTarget | null;
  /** A same-origin booth link consumed on entry or hash navigation; retained until this flow closes. */
  incomingArrivalToken: string | null;
  onArrive: () => void;
  /** TRACE_B has this participation's arrival: home leads to the keepsake. */
  arrived: boolean;
  /** Runs before the arrival goes: the photos' places still on their way get a moment to reach TRACE_B (#13). */
  onBeforeArrival: () => Promise<void>;
  /** TRACE_B has this memory session's arrival. */
  onArrived: (memorySessionId: string) => void;
  onCloseDemo: () => void;
  onTakePhoto: () => void;
  onSkip: () => void;
  /** Deletes one photo (#51): resolves to an error message, or null once it is gone. */
  onDeletePhoto: (entry: LogEntry) => Promise<string | null>;
  /** Where to ask about the data (TRACE_B's public config), shown after arriving. */
  contact: string;
  onWithdraw: () => Promise<void>;
  onDeveloper: () => void;
  /** Back to the participant's screens, for the TRACE mark in the demo, even one opened on the developer screen. */
  onHome: () => void;
};

export function RayApp(props: RayAppProps) {
  const [overlay, setOverlay] = useState<OverlayName | null>(null);
  const close = () => setOverlay(null);
  // The photo asked about before it is deleted, and which of the day's it is.
  const [deleting, setDeleting] = useState<{ entry: LogEntry; number: number } | null>(null);
  // Checked once, on the title: whether this phone and browser can join, and how.
  const [entry] = useState<EntryCheck>(entryCheck);
  const entrance = !props.joined && (entry === "in-app" || entry === "ios-browser");
  // Back at the title from the TRACE mark while taking part; it goes with the participation.
  const [title, setTitle] = useState(false);
  if (title && !props.joined) setTitle(false);

  const menuItems: MenuItem[] = [
    { label: "遊び方", onSelect: () => setOverlay("howto") },
    ...(props.consent ? [{ label: "同意事項", onSelect: () => setOverlay("consent") }] : []),
    ...(props.onStop ? [{ label: "記録を残して参加を終了", onSelect: () => setOverlay("stop"), disabled: props.busy }] : []),
    ...(props.consent || props.joined ? [{ label: "参加をやめる", onSelect: () => setOverlay("withdraw"), disabled: props.busy }] : []),
  ];

  const layer = deleting ? (
    <DeletePhotoLayer
      entry={deleting.entry}
      number={deleting.number}
      arrived={props.arrived}
      onConfirm={() => props.onDeletePhoto(deleting.entry)}
      onClose={() => setDeleting(null)}
    />
  ) : overlay === "menu" ? (
      <MenuLayer items={menuItems} onClose={close} />
    ) : overlay === "howto" || overlay === "start" ? (
      <HowToLayer
        reminderMinutes={props.reminderTerms.intervalMinutes}
        onNext={
          overlay === "start"
            ? () => {
                close();
                props.onOpenConsent();
              }
            : undefined
        }
        onClose={close}
      />
    ) : overlay === "install" ? (
      <InstallLayer
        support={entrance ? entry : props.support}
        reminderMinutes={props.reminderTerms.intervalMinutes}
        beforeJoining={!props.joined}
        onContinue={entrance && entry === "ios-browser" ? () => setOverlay("start") : undefined}
        onClose={close}
      />
    ) : overlay === "consent" ? (
      <ConsentLayer terms={props.consent} onClose={close} />
    ) : overlay === "stop" && props.onStop ? (
      <StopLayer onConfirm={props.onStop} onClose={close} />
    ) : overlay === "withdraw" ? (
      <WithdrawLayer
        onConfirm={async () => {
          await props.onWithdraw();
          close();
        }}
        onClose={close}
      />
    ) : null;

  return (
    <div className="ray">
      <RayStage overlay={layer}>
        <Current
          {...props}
          entry={entry}
          title={title}
          onTitle={setTitle}
          inert={overlay !== null || deleting !== null}
          openOverlay={setOverlay}
          askDelete={(photo, number) => setDeleting({ entry: photo, number })}
        />
      </RayStage>
    </div>
  );
}

function Current(
  props: RayAppProps & {
    entry: EntryCheck;
    title: boolean;
    onTitle: (title: boolean) => void;
    inert: boolean;
    openOverlay: (name: OverlayName) => void;
    askDelete: (entry: LogEntry, number: number) => void;
  },
) {
  const { go, field, fx } = useRay();
  const { inert } = props;
  const full = props.photos.length >= props.maxPhotos;
  const onMenu = () => props.openOverlay("menu");
  const onInstall = () => props.openOverlay("install");
  // The TRACE mark leads to the title from every screen that has it.
  const toTitle = () => void go(() => props.onTitle(true));
  // Home's QR code button after arriving: the arrival opens on the camera, for another replay.
  const [again, setAgain] = useState(false);

  // A skip still clears: the screen tears and flashes negative, as a photo does.
  const skip = async () => {
    if (!reducedMotion()) {
      void fx?.tear(300, 1);
      field?.burst(0.9);
      await fx?.flash(SWAP, 90);
    }
    props.onSkip();
  };

  if (props.demo === "home" && props.arrival && (!props.ended || props.arrived)) {
    return (
      <ArrivalFlow
        key={props.incomingArrivalToken ?? (again ? "again" : "camera")}
        target={props.arrival}
        incomingArrivalToken={props.incomingArrivalToken}
        photos={props.photos}
        contact={props.contact}
        toKeepsake={props.arrived}
        again={again}
        ended={props.ended}
        inert={inert}
        onClose={props.onCloseDemo}
        onTitle={() => props.onTitle(true)}
        beforeArrival={props.onBeforeArrival}
        onArrived={props.onArrived}
        onDelete={props.askDelete}
      />
    );
  }

  if (props.demo === "developer") {
    return (
      <DemoFlow
        closeLabel="開発者の画面にもどる"
        inert={inert}
        onClose={props.onCloseDemo}
      />
    );
  }

  if (!props.joined) {
    if (props.consentOpen) {
      return (
        <ConsentScreen
          terms={props.consentTerms}
          busy={props.joining}
          error={props.joinError}
          inert={inert}
          onAgree={() => void props.onAgree()}
          onDecline={() => void go(props.onCloseConsent)}
        />
      );
    }
    return (
      <TitleScreen
        notes={props.notes}
        // How to play comes first, and its 「次へ」 opens the consent.
        foot={{ entry: props.entry, onStart: () => props.openOverlay("start"), onInstall }}
        inert={inert}
        onDeveloper={props.onDeveloper}
        onMenu={onMenu}
      />
    );
  }

  if (!props.ended && props.shot && props.consent) {
    return (
      <PhotoScreen
        key={props.shot.id}
        shot={props.shot}
        consent={props.consent}
        offerReminder={props.shot.number === 1 && !props.reminderOn}
        lastPlace={props.photos.at(-1)?.record.place ?? null}
        maxPhotos={props.maxPhotos}
        support={props.support}
        reminderOn={props.reminderOn}
        reminderTerms={props.reminderTerms}
        busy={props.busy}
        nextReminderAt={props.nextReminderAt}
        inert={inert}
        onRetake={props.onRetake}
        onSave={props.onSave}
        onReminder={props.onReminder}
        onInstall={onInstall}
        onClose={props.onCloseShot}
      />
    );
  }

  if (!props.ended && props.skipped) {
    return <SkipScreen at={props.skipped} nextReminderAt={props.nextReminderAt} inert={inert} onClose={() => void go(props.onCloseSkip)} />;
  }

  if (!props.ended && props.pingOpen && props.pendingAt) {
    return (
      <PingScreen
        pendingAt={props.pendingAt}
        full={full}
        inert={inert}
        onTakePhoto={props.onTakePhoto}
        onSkip={() => void skip()}
        onClose={() => void go(props.onClosePing)}
      />
    );
  }

  // A reminder, a photo or a skip above still comes first; the notes are for the home screen.
  if (props.title) {
    return (
      <TitleScreen
        notes={[]}
        foot={{ onHome: () => void go(() => props.onTitle(false)) }}
        inert={inert}
        onDeveloper={props.onDeveloper}
        onMenu={onMenu}
      />
    );
  }

  return (
    <HomeScreen
      photos={props.photos}
      ended={props.ended}
      maxPhotos={props.maxPhotos}
      pendingAt={props.ended ? null : props.pendingAt}
      reminderOn={!props.ended && props.reminderOn}
      nextReminderAt={props.nextReminderAt}
      reminderTerms={props.reminderTerms}
      support={props.support}
      busy={props.busy}
      message={props.notes.join("")}
      inert={inert}
      onTakePhoto={props.onTakePhoto}
      onSkip={() => void skip()}
      onReminder={props.onReminder}
      onReminderInterval={props.onReminderInterval}
      arrived={props.arrived}
      onDelete={props.askDelete}
      onArrive={() => {
        setAgain(false);
        void go(props.onArrive);
      }}
      onArriveAgain={() => {
        setAgain(true);
        void go(props.onArrive);
      }}
      onDeveloper={props.onDeveloper}
      onMenu={onMenu}
      onInstall={onInstall}
      onTitle={toTitle}
    />
  );
}
