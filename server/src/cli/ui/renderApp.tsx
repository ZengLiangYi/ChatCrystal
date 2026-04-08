import React from 'react';
import { render } from 'ink';
import { App } from './App.js';
import type { ViewState } from './hooks/useViewStack.js';
import type { CrystalClient } from '../client.js';

/**
 * Render the interactive App with a given initial view.
 * Returns a promise that resolves when the user exits.
 */
export async function renderApp(client: CrystalClient, initialView: ViewState): Promise<void> {
  // Ensure server is available before entering interactive mode
  await client.ensureServer();

  const { waitUntilExit } = render(
    <App client={client} initialView={initialView} />,
  );

  await waitUntilExit();
}
