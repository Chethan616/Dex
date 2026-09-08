//! Generative UI: a typed spec the planner emits, drawn with the same
//! components the rest of the app uses.
//!
//! The registry is `render.rs`'s match. It is the one place a new component
//! is exposed to the planner, which is what makes the system extensible
//! without a rewrite: add a node type there and to `core/genui/schema.ts`,
//! and the planner can use it.

pub mod render;
pub mod spec;

pub use render::GenUi;
pub use spec::UiNode;
// The full envelope is the wire shape; the renderer only ever needs the root.
#[allow(unused_imports)]
pub use spec::UiSpec;
