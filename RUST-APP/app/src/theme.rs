//! Phase 0 gate.
//!
//! Renders one of each thing the rest of the app depends on being exact:
//! the Button variants, an icon, the oklch surface tokens and the Inter face.
//! If this page looks like rust-ui.com, the vendoring is correct and Phase 1
//! can start. If it does not, nothing built on top of it will be right either.

use icons::{Check, TriangleAlert};
use leptos::prelude::*;
use registry::ui::badge::{Badge, BadgeVariant};
use registry::ui::button::{Button, ButtonSize, ButtonVariant};
use registry::ui::card::{Card, CardContent, CardDescription, CardHeader, CardTitle};
use registry::ui::spinner::Spinner;

/// The surface tokens, in the order they appear in `style/tailwind.css`.
/// Each swatch is painted with the token itself, so a missing variable shows
/// up as a blank tile rather than silently falling back to something plausible.
const SURFACES: &[(&str, &str)] = &[
    ("background", "bg-background"),
    ("card", "bg-card"),
    ("popover", "bg-popover"),
    ("primary", "bg-primary"),
    ("secondary", "bg-secondary"),
    ("muted", "bg-muted"),
    ("accent", "bg-accent"),
    ("destructive", "bg-destructive"),
    ("success", "bg-success"),
    ("warning", "bg-warning"),
    ("info", "bg-info"),
    ("sidenav", "bg-sidenav"),
];

#[component]
pub fn ThemeProbe() -> impl IntoView {
    let dark = RwSignal::new(true);

    // The theme is a class on <html>, matching upstream's
    // `@custom-variant dark (&:is(.dark *))`.
    Effect::new(move |_| {
        let is_dark = dark.get();
        if let Some(doc) = web_sys::window().and_then(|w| w.document())
            && let Some(root) = doc.document_element()
        {
            let list = root.class_list();
            let _ = if is_dark {
                list.add_1("dark")
            } else {
                list.remove_1("dark")
            };
        }
    });

    view! {
        <main class="min-h-screen bg-background text-foreground">
            <div class="flex flex-col gap-8 py-12 px-6 mx-auto w-full max-w-3xl">
                <header class="flex gap-4 justify-between items-center">
                    <div class="flex flex-col gap-1">
                        <h1 class="text-2xl font-semibold tracking-tight">"RUST-APP"</h1>
                        <p class="text-sm text-muted-foreground">
                            "Phase 0 — vendored rust-ui renders with exact tokens."
                        </p>
                    </div>
                    <Button
                        variant=ButtonVariant::Outline
                        size=ButtonSize::Sm
                        on:click=move |_| dark.update(|d| *d = !*d)
                    >
                        {move || if dark.get() { "Light" } else { "Dark" }}
                    </Button>
                </header>

                <Card>
                    <CardHeader>
                        <CardTitle>"Buttons"</CardTitle>
                        <CardDescription>"Every variant, straight from the vendored crate."</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div class="flex flex-wrap gap-2 items-center">
                            <Button>"Default"</Button>
                            <Button variant=ButtonVariant::Secondary>"Secondary"</Button>
                            <Button variant=ButtonVariant::Outline>"Outline"</Button>
                            <Button variant=ButtonVariant::Ghost>"Ghost"</Button>
                            <Button variant=ButtonVariant::Destructive>"Destructive"</Button>
                            <Button variant=ButtonVariant::Success>
                                <Check />
                                "Success"
                            </Button>
                            <Button variant=ButtonVariant::Warning>
                                <TriangleAlert />
                                "Warning"
                            </Button>
                            <Button variant=ButtonVariant::Link>"Link"</Button>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>"Surfaces"</CardTitle>
                        <CardDescription>"A blank tile means a missing CSS variable."</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            {SURFACES
                                .iter()
                                .map(|(name, class)| {
                                    view! {
                                        <div class="flex flex-col gap-1.5">
                                            <div class=format!(
                                                "h-12 w-full rounded-md border border-border {class}",
                                            )></div>
                                            <span class="font-mono text-xs text-muted-foreground">{*name}</span>
                                        </div>
                                    }
                                })
                                .collect_view()}
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>"Badges, icons, motion"</CardTitle>
                        <CardDescription>"Icons come from the published rust-ui icons crate."</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div class="flex flex-wrap gap-3 items-center">
                            <Badge>"Default"</Badge>
                            <Badge variant=BadgeVariant::Secondary>"Secondary"</Badge>
                            <Badge variant=BadgeVariant::Destructive>"Destructive"</Badge>
                            <Badge variant=BadgeVariant::Outline>"Outline"</Badge>
                            <Spinner />
                        </div>
                    </CardContent>
                </Card>

                <p class="text-xs text-muted-foreground">
                    "Type should be Inter. Radius should be 0.625rem."
                </p>
            </div>
        </main>
    }
}
