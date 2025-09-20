/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { ObjectId } from 'mongodb';
export function toObjectId(id) {
    if (id instanceof ObjectId) return id;
    try {
      return new ObjectId(id);
  } catch {
      throw new Error(`Invalid ID: ${id}`);
    }
  }