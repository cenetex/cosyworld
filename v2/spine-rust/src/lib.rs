//! cosyworld-spine: the greenfield commit spine for the CosyWorld orchestrator.
//!
//! A vertical slice of the target architecture described in issue #706:
//! one commit pipeline over a kernel port, a projection registry, and an
//! append-only journal, driven by a world loop that owns all mutable state.
//! See `README.md` for the mapping to the live `main.rs` structures.

pub mod journal;
pub mod kernel;
pub mod pipeline;
pub mod projection;
pub mod turns;
pub mod types;
pub mod world;
