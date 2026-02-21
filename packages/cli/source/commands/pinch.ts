import { command } from "@gud/cli";
import { c } from "../ui/theme.js";

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

export default command({
  description: "A claw-some easter egg",
  handler: async ({ client }) => {
    const fact = FACTS[Math.floor(Math.random() * FACTS.length)]!;
    client.log(c.brand(CLAW_ART));
    client.log(`   ${c.muted(`🦀 ${fact}`)}`);
  },
});
