import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { useExit } from "../ui/hooks.js";
import { colors } from "../ui/theme.js";

const CLAW_ART = `
        ╭━━╮   ╭━━╮
       ╭╯  ╰╮ ╭╯  ╰╮
       │ ╭╮ │ │ ╭╮ │
       │ ││ ╰─╯ ││ │
       │ ╰╯     ╰╯ │
       ╰╮   ╭─╮   ╭╯
        │   │ │   │
        ╰───╯ ╰───╯
          ╱     ╲
         ╱       ╲
        ╱   snip   ╲
       ╱    snip    ╲
`;

const FACTS = [
  "Crabs have been around for over 200 million years. Your gateway has been around for slightly less.",
  "A group of crabs is called a 'cast'. A group of gateways is called 'overengineering'.",
  "The Japanese spider crab has a leg span of up to 3.7 meters. Your config file is not that big.",
  "Crabs can walk in all directions, but prefer to walk sideways. Your agent prefers to walk forward.",
  "Hermit crabs swap shells when they find bigger ones. Your gateway swaps configs on restart.",
  "The coconut crab can crack coconuts with its claws. Your gateway can crack... tasks.",
  "Some crabs communicate by drumming their claws. Your gateway communicates via Telegram.",
  "Fiddler crabs wave their large claw to attract mates. Your CLI waves banners to attract developers.",
];

export default function Pinch() {
  const [ready, setReady] = useState(false);
  const fact = FACTS[Math.floor(Math.random() * FACTS.length)]!;

  useExit({ done: ready });

  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Box flexDirection="column" gap={1}>
      <Text color={colors.brand}>{CLAW_ART}</Text>
      <Box paddingLeft={3}>
        <Text color={colors.muted} italic>🦀 {fact}</Text>
      </Box>
    </Box>
  );
}
