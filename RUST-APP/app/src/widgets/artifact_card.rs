//! Result cards.
//!
//! `Artifact` is a fixed contract, not free-form: each `kind` is a set of
//! fields the UI knows how to draw. `kind: "files"` is a list; `kind:
//! "reading"` is prose with an optional inline image.
//!
//! When several files come back the spec asks for a carousel; a single result
//! gets a plain row, because a carousel of one is a control with nothing to do.

use icons::{FileText, FolderOpen};
use leptos::prelude::*;
use registry::ui::badge::{Badge, BadgeVariant};
use registry::ui::card::{Card, CardContent, CardDescription, CardHeader, CardSize, CardTitle};
use registry::ui::card_carousel::{
    CardCarousel, CardCarouselSlide, CardCarouselTrack,
};
use registry::ui::scroll_area::ScrollArea;

use dex_protocol::{Artifact, ArtifactItem};

/// Extensions the reading card renders inline rather than linking.
const IMAGE_EXTENSIONS: &[&str] = &[".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"];

#[component]
pub fn ArtifactCard(artifact: Artifact) -> impl IntoView {
    if artifact.is_reading() {
        view! { <ReadingCard artifact=artifact /> }.into_any()
    } else {
        view! { <FilesCard artifact=artifact /> }.into_any()
    }
}

#[component]
fn FilesCard(artifact: Artifact) -> impl IntoView {
    let items = artifact.items.clone();
    let shown = items.len();
    let total = artifact.total;
    let many = shown > 1;
    let title = artifact.title.clone();
    let note = artifact.note.clone();

    view! {
        <Card size=CardSize::Sm class="w-full">
            <CardHeader class="pt-4">
                <CardTitle class="text-sm">{title}</CardTitle>
                <CardDescription>
                    {if total > shown {
                        format!("showing {shown} of {total}")
                    } else {
                        format!("showing {shown}")
                    }}
                </CardDescription>
            </CardHeader>
            <CardContent class="pb-4">
                {if many {
                    view! {
                        <CardCarousel>
                            <CardCarouselTrack>
                                {items
                                    .clone()
                                    .into_iter()
                                    .map(|item| {
                                        view! {
                                            <CardCarouselSlide class="p-1 basis-full sm:basis-1/2">
                                                <FileRow item=item />
                                            </CardCarouselSlide>
                                        }
                                    })
                                    .collect_view()}
                            </CardCarouselTrack>
                        </CardCarousel>
                    }
                        .into_any()
                } else {
                    view! {
                        <div class="flex flex-col gap-2">
                            {items
                                .clone()
                                .into_iter()
                                .map(|item| view! { <FileRow item=item /> })
                                .collect_view()}
                        </div>
                    }
                        .into_any()
                }}
                {note.map(|note| view! { <p class="pt-3 text-xs text-muted-foreground">{note}</p> })}
            </CardContent>
        </Card>
    }
}

#[component]
fn FileRow(item: ArtifactItem) -> impl IntoView {
    let detail = item.detail.clone().unwrap_or_default();
    let size = item.bytes.map(human_bytes);
    let has_detail = !detail.is_empty();
    let reasons = item.reasons.clone();
    let has_reasons = !reasons.is_empty();
    let label = item.label.clone();
    let excerpt = item.excerpt.clone();

    view! {
        <div class="flex gap-3 items-start p-3 rounded-md border border-border bg-card">
            <FolderOpen class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div class="flex flex-col gap-1 min-w-0 grow">
                <span class="text-sm font-medium truncate">{label}</span>
                <Show when=move || has_detail>
                    <span class="font-mono text-xs break-all text-muted-foreground">
                        {detail.clone()}
                    </span>
                </Show>
                <Show when=move || has_reasons>
                    <span class="flex flex-wrap gap-1 pt-0.5">
                        {reasons
                            .clone()
                            .into_iter()
                            .map(|reason| {
                                view! { <Badge variant=BadgeVariant::Secondary>{reason}</Badge> }
                            })
                            .collect_view()}
                    </span>
                </Show>
                {excerpt
                    .map(|excerpt| {
                        view! {
                            <span class="pt-1 text-xs italic text-muted-foreground line-clamp-2">
                                {excerpt}
                            </span>
                        }
                    })}
            </div>
            {size
                .map(|size| {
                    view! { <span class="text-xs shrink-0 text-muted-foreground">{size}</span> }
                })}
        </div>
    }
}

#[component]
fn ReadingCard(artifact: Artifact) -> impl IntoView {
    let file = artifact.file.clone().unwrap_or_default();
    let is_image = IMAGE_EXTENSIONS
        .iter()
        .any(|ext| file.to_lowercase().ends_with(ext));
    let title = artifact.title.clone();
    let alt = artifact.title.clone();
    let body = artifact.body.clone().unwrap_or_default();
    let src = format!("file://{file}");
    let has_file = !file.is_empty();
    // A `Show` child is rebuilt on every evaluation, so it needs its own copy
    // rather than a borrow of one that the image branch also moves.
    let file_label = StoredValue::new(file);

    view! {
        <Card size=CardSize::Sm class="w-full">
            <CardHeader class="pt-4">
                <CardTitle class="flex gap-2 items-center text-sm">
                    <FileText class="size-4 text-muted-foreground" />
                    {title}
                </CardTitle>
                <Show when=move || has_file>
                    <CardDescription class="font-mono break-all">
                        {move || file_label.get_value()}
                    </CardDescription>
                </Show>
            </CardHeader>
            <CardContent class="pb-4">
                {if is_image {
                    view! {
                        <img
                            src=src
                            alt=alt
                            class="max-w-full h-auto rounded-md border border-border"
                        />
                    }
                        .into_any()
                } else {
                    view! {
                        <ScrollArea class="max-h-64">
                            <p class="text-sm whitespace-pre-wrap text-foreground/90">{body}</p>
                        </ScrollArea>
                    }
                        .into_any()
                }}
            </CardContent>
        </Card>
    }
}

/// Humanised size, matching the Flutter attachment sublabel.
fn human_bytes(bytes: f64) -> String {
    const UNITS: [&str; 4] = ["B", "KB", "MB", "GB"];
    let mut value = bytes;
    let mut unit = 0;
    while value >= 1024.0 && unit + 1 < UNITS.len() {
        value /= 1024.0;
        unit += 1;
    }
    let name = UNITS.get(unit).copied().unwrap_or("B");
    if unit == 0 {
        format!("{value:.0} {name}")
    } else {
        format!("{value:.1} {name}")
    }
}
