import React from "react";
import { Box, Text } from "ink";
import { useExit } from "../ui/hooks.js";
import { colors, getRandomBanner, getRandomTip } from "../ui/theme.js";

export default function Index() {
  useExit({ done: true });

  return (
    <Box flexDirection="column" gap={1}>
      <Text color={colors.brand}>{getRandomBanner()}</Text>
      <Box flexDirection="column" paddingLeft={3}>
        <Text bold>Commands:</Text>
        <Text>
          <Text color={colors.info}>config init</Text>
          <Text color={colors.muted}>{" ".repeat(8)}· </Text>
          <Text>Create a fresh configuration file</Text>
        </Text>
        <Text>
          <Text color={colors.info}>config validate</Text>
          <Text color={colors.muted}>{" ".repeat(4)}· </Text>
          <Text>Validate your current config</Text>
        </Text>
        <Text>
          <Text color={colors.info}>config edit</Text>
          <Text color={colors.muted}>{" ".repeat(8)}· </Text>
          <Text>Open config in your editor</Text>
        </Text>
        <Text>
          <Text color={colors.info}>service install</Text>
          <Text color={colors.muted}>{" ".repeat(3)}· </Text>
          <Text>Install the gateway as a system service</Text>
        </Text>
        <Text>
          <Text color={colors.info}>service status</Text>
          <Text color={colors.muted}>{" ".repeat(4)}· </Text>
          <Text>Check if the gateway service is installed/running</Text>
        </Text>
        <Text>
          <Text color={colors.info}>service start</Text>
          <Text color={colors.muted}>{" ".repeat(5)}· </Text>
          <Text>Start the gateway service</Text>
        </Text>
        <Text>
          <Text color={colors.info}>service stop</Text>
          <Text color={colors.muted}>{" ".repeat(6)}· </Text>
          <Text>Stop the gateway service</Text>
        </Text>
        <Text>
          <Text color={colors.info}>service restart</Text>
          <Text color={colors.muted}>{" ".repeat(3)}· </Text>
          <Text>Restart the gateway service</Text>
        </Text>
        <Text>
          <Text color={colors.info}>gateway status</Text>
          <Text color={colors.muted}>{" ".repeat(4)}· </Text>
          <Text>Query the running gateway for live status</Text>
        </Text>
        <Text>
          <Text color={colors.info}>gateway reload</Text>
          <Text color={colors.muted}>{" ".repeat(4)}· </Text>
          <Text>Check gateway health / signal a reload</Text>
        </Text>
        <Text>
          <Text color={colors.info}>doctor</Text>
          <Text color={colors.muted}>{" ".repeat(12)}· </Text>
          <Text>Run diagnostics on your setup</Text>
        </Text>
      </Box>
      <Box paddingLeft={3}>
        <Text color={colors.muted}>💡 tip: {getRandomTip()}</Text>
      </Box>
    </Box>
  );
}
