"use client";

import * as React from "react";
import { SopProse } from "@/components/sop/sop-prose";
import { fillDemoNumbers, workOut } from "@/lib/demo-calc";

/**
 * The two numbers a founder types into the demo calculator, held for the whole
 * document rather than inside the calculator, so the script further down can
 * say them back (`DemoFilledProse`).
 */
type DemoInputs = {
  callsPerWeek: string;
  ticket: string;
  setCallsPerWeek: (v: string) => void;
  setTicket: (v: string) => void;
};

const DemoInputsContext = React.createContext<DemoInputs | null>(null);

export function DemoNumbersProvider({ children }: { children: React.ReactNode }) {
  // Blank rather than pre-filled: a number already in the box gets read out as
  // though the prospect said it.
  const [callsPerWeek, setCallsPerWeek] = React.useState("");
  const [ticket, setTicket] = React.useState("");
  const value = React.useMemo(
    () => ({ callsPerWeek, ticket, setCallsPerWeek, setTicket }),
    [callsPerWeek, ticket],
  );
  return (
    <DemoInputsContext.Provider value={value}>{children}</DemoInputsContext.Provider>
  );
}

export function useDemoInputs(): DemoInputs {
  const inputs = React.useContext(DemoInputsContext);
  if (!inputs) throw new Error("useDemoInputs needs a DemoNumbersProvider above it.");
  return inputs;
}

/** A section of the document with the calculator's figures written into its
 *  placeholders, updating as they are typed. */
export function DemoFilledProse({ html, className }: { html: string; className?: string }) {
  const { callsPerWeek, ticket } = useDemoInputs();
  return (
    <SopProse
      html={fillDemoNumbers(html, workOut(callsPerWeek, ticket))}
      className={className}
    />
  );
}
