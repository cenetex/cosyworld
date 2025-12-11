/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 *
 * @file container.mjs
 * @description Dependency Injection Container entrypoint for CosyWorld
 *
 * Keep this file minimal.
 * The real registrations/initialization live in `src/container/*`.
 */

import { container, logger, configService } from './container/core.mjs';
import { registerPreReady as _registerPreReady, registerPostReady } from './container/registrations.mjs';
import { initializeContainer } from './container/initializeContainer.mjs';

_registerPreReady({ container });

export const containerReady = initializeContainer({ container, logger, configService });

// Keep historical ordering: registered after containerReady is created.
registerPostReady({ container });

export { container };
