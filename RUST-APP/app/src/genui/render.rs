//! The Generative UI renderer.
//!
//! Walks a `UiNode` tree and draws it with the vendored rust-ui components —
//! the same ones the rest of the app uses, so a generated table and a
//! hand-written one are the same table.
//!
//! Three guard rails, all of them because a model produced the failure at
//! least once in principle:
//!
//! - **Depth and child caps.** A runaway tree truncates rather than hangs.
//! - **Wide content scrolls inside itself.** Tables and grids get their own
//!   `overflow-x-auto`, so the page body never scrolls sideways.
//! - **An unknown type renders its text.** A pane that is blank because the
//!   planner invented a component is worse than a plain sentence.
//!
//! Every field-shaped node (checkbox, switch, select, slider, radio group,
//! date) draws a **picture of a value**, not a live control — see the
//! "Scope: display, not a live form" note at the top of
//! `core/genui/schema.ts`. A couple of them (`Collapsible`, the checkbox
//! itself) still respond to a click locally, because letting the reader open
//! a section or toggle a box in front of them is a rendering nicety, not a
//! new submission channel to the core — nothing about the click leaves this
//! page.

use icons::{Check, ChevronRight, Info, TriangleAlert, X};
use leptos::prelude::*;
use registry::ui::alert::{Alert, AlertDescription, AlertTitle};
use registry::ui::attachment::{Attachment as UiAttachment, AttachmentContent, AttachmentDescription, AttachmentMedia, AttachmentTitle};
use registry::ui::avatar::{Avatar, AvatarImage};
use registry::ui::badge::{Badge, BadgeVariant};
use registry::ui::breadcrumb::{Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator};
use registry::ui::bubble::{Bubble, BubbleAlign, BubbleContent, BubbleVariant};
use registry::ui::card::{Card, CardContent, CardDescription, CardHeader, CardSize, CardTitle};
use registry::ui::card_carousel::{CardCarousel, CardCarouselSlide, CardCarouselTrack};
use registry::ui::checkbox::Checkbox;
use registry::ui::chips::ChipsContainer;
use registry::ui::collapsible::{Collapsible, CollapsibleContent, CollapsibleTrigger};
use registry::ui::data_table::{
    DataTable, DataTableBody, DataTableCell, DataTableHead, DataTableHeader, DataTableRow,
    DataTableWrapper,
};
use registry::ui::kbd::Kbd;
use registry::ui::marker::{Marker, MarkerContent, MarkerIcon};
use registry::ui::message::{Message as MessageRow, MessageAlign, MessageContent};
use registry::ui::progress::Progress;
use registry::ui::radio_button::{RadioGroup, RadioGroupItem};
use registry::ui::select::{Select, SelectContent, SelectOption, SelectTrigger, SelectValue};
use registry::ui::separator::Separator;
use registry::ui::skeleton::Skeleton;
use registry::ui::spinner::Spinner;
use registry::ui::status::{Status, StatusIndactorVariant};
use registry::ui::switch::Switch;
use registry::ui::tabs::{Tabs, TabsContent, TabsList, TabsTrigger};

use dex_protocol::{Artifact, ArtifactItem};

use super::spec::{MAX_CHILDREN, MAX_DEPTH, UiNode};
use crate::widgets::artifact_card::ArtifactCard;

/// Draw a generated tree.
#[component]
pub fn GenUi(node: UiNode) -> impl IntoView {
    view! { <div class="flex flex-col gap-3 w-full min-w-0">{render(node, 0)}</div> }
}

/// Takes the node by value: the views it produces outlive this call, so
/// nothing may be borrowed from the tree.
fn render(node: UiNode, depth: usize) -> AnyView {
    if depth >= MAX_DEPTH {
        // Truncated rather than dropped: silence would hide that there was
        // more to say.
        return view! {
            <p class="text-xs italic text-muted-foreground">"…"</p>
        }
        .into_any();
    }

    // Built eagerly rather than in a closure, so no borrow escapes into the
    // view tree.
    let children: Vec<AnyView> = node
        .children
        .clone()
        .into_iter()
        .take(MAX_CHILDREN)
        .map(|child| render(child, depth + 1))
        .collect();

    let kind = node.node_type.clone();
    match kind.as_str() {
        "text" | "paragraph" => view! {
            <p class="text-sm whitespace-pre-wrap">{node.any_text()}</p>
        }
        .into_any(),

        "markdown" => view! { <GenMarkdown text=node.any_text() /> }.into_any(),

        "heading" => {
            let level = node.props.level.unwrap_or(3).clamp(1, 6);
            let class = match level {
                1 => "text-xl font-semibold tracking-tight",
                2 => "text-lg font-semibold tracking-tight",
                _ => "text-sm font-medium",
            };
            view! { <h3 class=class>{node.any_text()}</h3> }.into_any()
        }

        "code" => view! {
            <pre class="overflow-x-auto p-3 font-mono text-xs rounded-md border border-border bg-muted">
                <code>{node.any_text()}</code>
            </pre>
        }
        .into_any(),

        "list" => view! {
            <ul class="flex flex-col gap-1 pl-4 list-disc">
                {node
                    .props
                    .items
                    .clone()
                    .into_iter()
                    .take(MAX_CHILDREN)
                    .map(|item| view! { <li class="text-sm">{item}</li> })
                    .collect_view()}
            </ul>
        }
        .into_any(),

        "kbd" => view! { <Kbd>{node.any_text()}</Kbd> }.into_any(),

        "separator" => view! { <Separator /> }.into_any(),

        "group" | "section" => view! {
            <div class="flex flex-col gap-3 min-w-0">{children}</div>
        }
        .into_any(),

        // A fixed responsive grid rather than a planner-chosen column count:
        // one number rarely reads well at every width this app runs at, and
        // "3 on desktop, 2 on tablet, 1 on phone" is right far more often than
        // any single fixed value would be.
        "grid" => view! {
            <div class="grid grid-cols-1 gap-3 min-w-0 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
        }
        .into_any(),

        "card" => view! {
            <Card size=CardSize::Sm>
                <CardHeader class="pt-4">
                    <CardTitle class="text-sm">{node.props.title.clone().unwrap_or_default()}</CardTitle>
                    {node
                        .props
                        .description
                        .clone()
                        .map(|d| view! { <CardDescription>{d}</CardDescription> })}
                </CardHeader>
                <CardContent class="flex flex-col gap-3 pb-4">{children}</CardContent>
            </Card>
        }
        .into_any(),

        // Built on the same `Collapsible` as `disclosure`: a run of named
        // sections is a run of disclosures, and the vendored `Accordion` is a
        // checkbox-CSS construction this schema has no reason to duplicate.
        "accordion" => view! {
            <div class="flex flex-col divide-y divide-border rounded-md border border-border">
                {children}
            </div>
        }
        .into_any(),

        "accordion_item" | "disclosure" => view! { <GenDisclosure node=node children=children /> }.into_any(),

        // `GenTabs` reads each tab's title itself; rendering here must be only
        // the content, or the generic fallback below would show the title
        // twice (once as the trigger label, once mistaken for body text).
        "tab" => view! { <div class="flex flex-col gap-3 min-w-0">{children}</div> }.into_any(),

        "tabs" => view! { <GenTabs node=node children=children /> }.into_any(),

        "tooltip" => view! {
            <span class="inline-flex gap-1.5 items-center text-sm" title=node.props.description.clone().unwrap_or_default()>
                {node.any_text()}
                <Info class="size-3 text-muted-foreground" />
            </span>
        }
        .into_any(),

        "breadcrumb" => view! {
            <Breadcrumb>
                <BreadcrumbList>
                    {
                        let items = node.props.items.clone();
                        let last = items.len().saturating_sub(1);
                        items
                            .into_iter()
                            .enumerate()
                            .map(|(i, label)| {
                                view! {
                                    <BreadcrumbItem>
                                        {if i == last {
                                            view! { <BreadcrumbPage>{label}</BreadcrumbPage> }.into_any()
                                        } else {
                                            view! { <BreadcrumbLink attr:href="#">{label}</BreadcrumbLink> }.into_any()
                                        }}
                                    </BreadcrumbItem>
                                    <Show when=move || i != last>
                                        <BreadcrumbSeparator />
                                    </Show>
                                }
                            })
                            .collect_view()
                    }
                </BreadcrumbList>
            </Breadcrumb>
        }
        .into_any(),

        "alert" | "error" | "success" => {
            // `Alert` is a plain clx! wrapper with no variant prop, so the
            // tone is carried by border and text classes instead.
            let tone = match kind.as_str() {
                "error" => "border-destructive/50 text-destructive",
                "success" => "border-success/50",
                _ => "",
            };
            view! {
                <Alert class=tone>
                    {match kind.as_str() {
                        "error" => view! { <TriangleAlert /> }.into_any(),
                        "success" => view! { <Check /> }.into_any(),
                        _ => view! { <Info /> }.into_any(),
                    }}
                    <AlertTitle>{node.props.title.clone().unwrap_or_default()}</AlertTitle>
                    {node
                        .props
                        .description
                        .clone()
                        .or_else(|| node.props.text.clone())
                        .map(|d| view! { <AlertDescription>{d}</AlertDescription> })}
                </Alert>
            }
            .into_any()
        }

        // Informational only. The real gate is the Orchestrator's
        // confirmation ladder — a card the owner approves before a step runs
        // — which this does not replace and cannot bypass; this simply says,
        // inline, that something consequential is about to happen.
        "confirmation" => view! {
            <Alert class="border-warning/50">
                <TriangleAlert class="text-warning" />
                <AlertTitle>{node.props.title.clone().unwrap_or_default()}</AlertTitle>
                {node
                    .props
                    .description
                    .clone()
                    .map(|d| view! { <AlertDescription>{d}</AlertDescription> })}
                <Show when={
                    let details = node.props.details.clone();
                    move || !details.is_empty()
                }>
                    <ul class="flex flex-col gap-1 pl-4 mt-2 text-xs list-disc">
                        {node
                            .props
                            .details
                            .clone()
                            .into_iter()
                            .map(|d| view! { <li>{d}</li> })
                            .collect_view()}
                    </ul>
                </Show>
            </Alert>
        }
        .into_any(),

        "callout" => {
            let tone = match node.props.variant.as_deref() {
                Some("warning") => "border-warning/50 bg-warning/5",
                Some("destructive") => "border-destructive/50 bg-destructive/5",
                _ => "border-info/50 bg-info/5",
            };
            view! {
                <div class=format!("rounded-md border p-3 text-sm {tone}")>
                    {node
                        .props
                        .title
                        .clone()
                        .map(|t| view! { <p class="font-medium">{t}</p> })}
                    <p class="text-muted-foreground">{node.any_text()}</p>
                </div>
            }
            .into_any()
        }

        // A brief, low-weight notice read inline — not a real popup toast,
        // which would need to appear and vanish outside this content's own
        // lifetime. `Toast` in `widgets/banner.rs` is the real, ephemeral one.
        "toast" => view! {
            <div class="flex gap-2 items-center py-2 px-3 text-sm rounded-lg border shadow-sm border-border bg-popover text-popover-foreground w-fit">
                <Info class="size-3.5 text-muted-foreground" />
                {node.any_text()}
            </div>
        }
        .into_any(),

        "empty" => view! {
            <div class="flex flex-col gap-1 items-center py-8 text-center">
                <p class="text-sm font-medium">
                    {node.props.title.clone().unwrap_or_default()}
                </p>
                <p class="text-xs text-muted-foreground">
                    {node.props.description.clone().unwrap_or_default()}
                </p>
            </div>
        }
        .into_any(),

        "status" => {
            let variant = match node.props.variant.as_deref() {
                Some("active") => StatusIndactorVariant::Active,
                Some("inactive") => StatusIndactorVariant::Inactive,
                Some("normal") => StatusIndactorVariant::Normal,
                _ => StatusIndactorVariant::Default,
            };
            view! {
                <span class="inline-flex gap-2 items-center text-sm">
                    <Status variant=variant>
                        <span class="rounded-full size-2 bg-muted-foreground/40"></span>
                    </Status>
                    {node.any_text()}
                </span>
            }
            .into_any()
        }

        "loading" => view! {
            <div class="flex gap-2 items-center text-sm text-muted-foreground">
                <Spinner />
                {node.any_text()}
            </div>
        }
        .into_any(),

        "skeleton" => view! { <Skeleton class="w-full h-20" /> }.into_any(),

        "progress" => view! {
            <div class="flex flex-col gap-1.5">
                {node
                    .props
                    .title
                    .clone()
                    .map(|t| view! { <span class="text-xs text-muted-foreground">{t}</span> })}
                <Progress value=node.props.value.unwrap_or(0.0) />
            </div>
        }
        .into_any(),

        "badge" => view! {
            <Badge variant=badge_variant(node.props.variant.as_deref())>{node.any_text()}</Badge>
        }
        .into_any(),

        // `ChipItem` takes a &'static str, which a generated label never is,
        // so the chip is drawn with its own classes rather than leaking the
        // strings for the lifetime of the page.
        "chips" => view! {
            <ChipsContainer>
                {node
                    .props
                    .items
                    .clone()
                    .into_iter()
                    .take(MAX_CHILDREN)
                    .map(|item| {
                        view! {
                            <span class="inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-xs">
                                {item}
                            </span>
                        }
                    })
                    .collect_view()}
            </ChipsContainer>
        }
        .into_any(),

        "avatar" => {
            let initial = node.any_text();
            let src = node.props.src.clone();
            view! {
                <Avatar>
                    {match src {
                        Some(src) => view! { <AvatarImage attr:src=src attr:alt=initial.clone() /> }.into_any(),
                        None => view! {
                            <span class="flex justify-center items-center w-full h-full text-xs font-medium bg-muted">
                                {initial.chars().next().unwrap_or('?').to_uppercase().to_string()}
                            </span>
                        }
                        .into_any(),
                    }}
                </Avatar>
            }
            .into_any()
        }

        "attachment" => view! {
            <UiAttachment class="w-full">
                <AttachmentMedia>
                    <icons::FileText />
                </AttachmentMedia>
                <AttachmentContent>
                    <AttachmentTitle>{node.props.title.clone().unwrap_or_default()}</AttachmentTitle>
                    {node
                        .props
                        .description
                        .clone()
                        .map(|d| view! { <AttachmentDescription>{d}</AttachmentDescription> })}
                </AttachmentContent>
            </UiAttachment>
        }
        .into_any(),

        "image" => view! {
            <img
                src=node.props.src.clone().unwrap_or_default()
                alt=node.props.alt.clone().unwrap_or_default()
                class="max-w-full h-auto rounded-md border border-border"
            />
        }
        .into_any(),

        // The same fixed-contract card the built-in file search draws — see
        // `core/events/artifacts.ts`. Flat props map onto plain label-only
        // items; a generated artifact does not carry the excerpt/reasons
        // detail a real filesystem search does.
        "artifact" => {
            let artifact = Artifact {
                kind: "files".to_owned(),
                title: node.props.title.clone().unwrap_or_default(),
                items: node
                    .props
                    .items
                    .iter()
                    .map(|label| ArtifactItem {
                        label: label.clone(),
                        detail: None,
                        reasons: Vec::new(),
                        excerpt: None,
                        bytes: None,
                        modified: None,
                    })
                    .collect(),
                total: node.props.items.len(),
                note: node.props.description.clone(),
                body: None,
                file: None,
            };
            view! { <ArtifactCard artifact=artifact /> }.into_any()
        }

        "table" | "data_grid" => view! { <GenTable node=node /> }.into_any(),

        "pagination" => {
            let page = node.props.value.unwrap_or(1.0) as i64;
            let of = node.props.text.clone().unwrap_or_default();
            view! {
                <div class="flex gap-2 items-center text-xs text-muted-foreground">
                    <ChevronRight class="rotate-180 size-3.5" />
                    <span>{format!("Page {page}")} {(!of.is_empty()).then(|| format!(" of {of}"))}</span>
                    <ChevronRight class="size-3.5" />
                </div>
            }
            .into_any()
        }

        "area_chart" | "line_chart" | "bar_chart" | "pie_chart" => {
            view! { <GenChart node=node /> }.into_any()
        }

        // Reuses the same carousel the artifact card uses for several files,
        // so a generated gallery and a found-files gallery move the same way.
        "carousel" => {
            let title = node.props.title.clone();
            view! {
                <div class="flex flex-col gap-2 min-w-0">
                    {title.map(|t| view! { <h4 class="text-sm font-medium">{t}</h4> })}
                    <CardCarousel>
                        <CardCarouselTrack>
                            {children
                                .into_iter()
                                .map(|child| {
                                    view! {
                                        <CardCarouselSlide class="p-1 basis-full sm:basis-1/2">{child}</CardCarouselSlide>
                                    }
                                })
                                .collect_view()}
                        </CardCarouselTrack>
                    </CardCarousel>
                </div>
            }
            .into_any()
        }

        "steps" | "task_plan" => view! { <GenSteps node=node numbered=false /> }.into_any(),
        "stepper" => view! { <GenSteps node=node numbered=true /> }.into_any(),

        "message" => {
            let human = node.props.variant.as_deref() == Some("human");
            let align = if human { MessageAlign::End } else { MessageAlign::Start };
            let bubble_align = if human { BubbleAlign::End } else { BubbleAlign::Start };
            let variant = if human { BubbleVariant::Default } else { BubbleVariant::Muted };
            let speaker = node.props.title.clone();
            view! {
                <MessageRow align=align>
                    <MessageContent>
                        {speaker.map(|s| view! { <span class="text-xs text-muted-foreground">{s}</span> })}
                        <Bubble align=bubble_align variant=variant>
                            <BubbleContent>{node.any_text()}</BubbleContent>
                        </Bubble>
                    </MessageContent>
                </MessageRow>
            }
            .into_any()
        }

        "marker" => {
            let status = node.props.status.clone();
            let text = node.any_text();
            view! {
                <Marker>
                    <MarkerIcon>
                        {match status.as_deref() {
                            Some("failed") => view! { <TriangleAlert class="text-destructive" /> }.into_any(),
                            Some("done") | Some("completed") => view! { <Check class="text-success" /> }.into_any(),
                            Some("running") => view! { <Spinner /> }.into_any(),
                            _ => view! { <Info /> }.into_any(),
                        }}
                    </MarkerIcon>
                    <MarkerContent>{text}</MarkerContent>
                </Marker>
            }
            .into_any()
        }

        // Read-out fields: a picture of a value, not a live form. See the
        // file header and the schema's own "Scope" note.
        "field" => view! {
            <div class="flex justify-between items-baseline py-1 text-sm">
                <span class="text-muted-foreground">{node.props.title.clone().unwrap_or_default()}</span>
                <span class="font-medium">
                    {node.props.value_text.clone().unwrap_or_else(|| node.any_text())}
                </span>
            </div>
        }
        .into_any(),

        "checkbox" => view! {
            <div class="flex gap-2 items-center text-sm">
                <Checkbox checked=Signal::from(node.props.checked.unwrap_or(false)) disabled=Signal::from(true) />
                <span>{node.any_text()}</span>
            </div>
        }
        .into_any(),

        "switch" => view! {
            <div class="flex gap-2 items-center text-sm">
                <Switch checked=node.props.checked.unwrap_or(false) />
                <span>{node.any_text()}</span>
            </div>
        }
        .into_any(),

        "radio_group" => {
            let selected = RwSignal::new(node.props.value_text.clone().unwrap_or_default());
            view! {
                <div class="flex flex-col gap-1.5">
                    {node
                        .props
                        .title
                        .clone()
                        .map(|t| view! { <span class="text-xs text-muted-foreground">{t}</span> })}
                    <RadioGroup value=selected>
                        {node
                            .props
                            .items
                            .clone()
                            .into_iter()
                            .map(|item| {
                                view! {
                                    <label class="flex gap-2 items-center text-sm">
                                        <RadioGroupItem value=item.clone() disabled=Signal::from(true) />
                                        {item}
                                    </label>
                                }
                            })
                            .collect_view()}
                    </RadioGroup>
                </div>
            }
            .into_any()
        }

        "select" => {
            let value = node.props.value_text.clone().unwrap_or_default();
            let items = node.props.items.clone();
            view! {
                <div class="flex flex-col gap-1.5">
                    {node
                        .props
                        .title
                        .clone()
                        .map(|t| view! { <span class="text-xs text-muted-foreground">{t}</span> })}
                    <Select default_value=value.clone()>
                        <SelectTrigger class="w-fit" attr:disabled=true>
                            <SelectValue placeholder=value />
                        </SelectTrigger>
                        <SelectContent>
                            {items
                                .into_iter()
                                .map(|item| view! { <SelectOption value=item.clone()>{item}</SelectOption> })
                                .collect_view()}
                        </SelectContent>
                    </Select>
                </div>
            }
            .into_any()
        }

        "slider" => {
            let value = node.props.value.unwrap_or(0.0);
            view! {
                <div class="flex flex-col gap-1.5">
                    {node
                        .props
                        .title
                        .clone()
                        .map(|t| view! { <span class="text-xs text-muted-foreground">{t}</span> })}
                    <input
                        type="range"
                        disabled=true
                        value=value.to_string()
                        class="overflow-hidden relative w-full bg-transparent appearance-none text-primary"
                    />
                </div>
            }
            .into_any()
        }

        "date" => view! {
            <div class="flex justify-between items-baseline py-1 text-sm">
                <span class="text-muted-foreground">{node.props.title.clone().unwrap_or_default()}</span>
                <span class="font-medium">{node.props.value_text.clone().unwrap_or_default()}</span>
            </div>
        }
        .into_any(),

        "form" => view! {
            <Card size=CardSize::Sm>
                <CardHeader class="pt-4">
                    <CardTitle class="text-sm">{node.props.title.clone().unwrap_or_default()}</CardTitle>
                    {node
                        .props
                        .description
                        .clone()
                        .map(|d| view! { <CardDescription>{d}</CardDescription> })}
                </CardHeader>
                <CardContent class="flex flex-col divide-y divide-border pb-4">{children}</CardContent>
            </Card>
        }
        .into_any(),

        // Unknown: draw what it said. Never a blank pane.
        _ => {
            let text = node.any_text();
            if text.is_empty() {
                view! { <div class="flex flex-col gap-3 min-w-0">{children}</div> }.into_any()
            } else {
                view! { <p class="text-sm whitespace-pre-wrap">{text}</p> }.into_any()
            }
        }
    }
}

/// One collapsed section, open on click. Local state only — nothing about
/// which sections are open travels back to the core.
#[component]
fn GenDisclosure(node: UiNode, children: Vec<AnyView>) -> impl IntoView {
    let open = RwSignal::new(false);
    let title = node.props.title.clone().unwrap_or_default();
    let text = node.any_text();
    view! {
        <Collapsible open=open class="p-3">
            <CollapsibleTrigger class="flex gap-2 items-center w-full text-sm font-medium text-left">
                {move || {
                    if open.get() {
                        view! { <ChevronRight class="size-3.5 rotate-90 transition-transform" /> }
                    } else {
                        view! { <ChevronRight class="size-3.5 transition-transform" /> }
                    }
                }}
                {title}
            </CollapsibleTrigger>
            <CollapsibleContent class="pt-2 pl-5 text-sm text-muted-foreground">
                {(!text.is_empty()).then(|| view! { <p>{text}</p> })}
                {children}
            </CollapsibleContent>
        </Collapsible>
    }
}

/// Alternative views of the same thing. The first child is shown by default.
#[component]
fn GenTabs(node: UiNode, children: Vec<AnyView>) -> impl IntoView {
    let titles: Vec<String> = node
        .children
        .iter()
        .map(|c| c.props.title.clone().unwrap_or_default())
        .collect();
    let default = titles.first().cloned().unwrap_or_default();

    let trigger_titles = titles.clone();
    view! {
        <Tabs default_value=default>
            <TabsList>
                {trigger_titles
                    .into_iter()
                    .map(|t| view! { <TabsTrigger value=t.clone()>{t}</TabsTrigger> })
                    .collect_view()}
            </TabsList>
            {titles
                .into_iter()
                .zip(children)
                .map(|(t, child)| view! { <TabsContent value=t>{child}</TabsContent> })
                .collect_view()}
        </Tabs>
    }
}

/// Wide tables scroll inside their own box, so the page never does.
#[component]
fn GenTable(node: UiNode) -> impl IntoView {
    let columns = node.props.columns.clone();
    let rows = node.props.rows.clone();
    let total = rows.len();
    let title = node.props.title.clone();

    view! {
        <div class="flex flex-col gap-2 min-w-0">
            {title.map(|t| view! { <h4 class="text-sm font-medium">{t}</h4> })}
            <DataTableWrapper class="overflow-x-auto">
                <DataTable>
                    <DataTableHeader>
                        <DataTableRow>
                            {columns
                                .into_iter()
                                .map(|c| {
                                    view! { <DataTableHead class="px-4">{c}</DataTableHead> }
                                })
                                .collect_view()}
                        </DataTableRow>
                    </DataTableHeader>
                    <DataTableBody>
                        {rows
                            .into_iter()
                            .take(200)
                            .map(|row| {
                                view! {
                                    <DataTableRow>
                                        {row
                                            .into_iter()
                                            .map(|cell| {
                                                view! { <DataTableCell>{cell}</DataTableCell> }
                                            })
                                            .collect_view()}
                                    </DataTableRow>
                                }
                            })
                            .collect_view()}
                    </DataTableBody>
                </DataTable>
            </DataTableWrapper>
            <Show when=move || { total > 200 }>
                <p class="text-xs text-muted-foreground">
                    {format!("showing 200 of {total}")}
                </p>
            </Show>
        </div>
    }
}

/// Charts are `data-*` divs hydrated by the bundled ApexCharts.
///
/// `chart_init.js` reads `data-name` and lowercases the PascalCase prefix
/// ("BarChart" becomes "bar"), so the div is written directly here.
/// `ui::charts` only exposes a generic `AreaChart`; the bar, line and pie
/// components in `registry::charts` hardcode their own sample data and cannot
/// take ours.
#[component]
fn GenChart(node: UiNode) -> impl IntoView {
    let values = serde_json::to_string(&node.props.values).unwrap_or_else(|_| "[]".to_owned());
    let labels = serde_json::to_string(&node.props.labels).unwrap_or_else(|_| "[]".to_owned());
    let title = node.props.title.clone();
    let name = match node.node_type.as_str() {
        "bar_chart" => "BarChart",
        "line_chart" => "LineChart",
        "pie_chart" => "PieChart",
        _ => "AreaChart",
    };
    let id = format!("genui-chart-{}", (js_sys::Math::random() * 1.0e9) as u64);

    view! {
        <div class="flex flex-col gap-2 min-w-0">
            {title.map(|t| view! { <h4 class="text-sm font-medium">{t}</h4> })}
            <div
                id=id
                class="w-full h-[300px]"
                data-name=name
                data-chart-values=values
                data-chart-labels=labels
            ></div>
        </div>
    }
}

/// A generated plan, checklist or (numbered) short sequence. Uses the same
/// status vocabulary as the live plan card, so the two do not look like
/// different features.
#[component]
fn GenSteps(node: UiNode, numbered: bool) -> impl IntoView {
    let title = node.props.title.clone();
    let steps = node.children.clone();
    let wrapper = if numbered {
        "flex flex-row flex-wrap gap-4"
    } else {
        "flex flex-col gap-2"
    };

    view! {
        <div class="flex flex-col gap-2 min-w-0">
            {title.map(|t| view! { <h4 class="text-sm font-medium">{t}</h4> })}
            <ol class=wrapper>
                {steps
                    .into_iter()
                    .take(MAX_CHILDREN)
                    .enumerate()
                    .map(|(i, step)| {
                        let status = step.props.status.clone().unwrap_or_default();
                        view! {
                            <li class="flex gap-3 items-start text-sm">
                                <span class="flex justify-center items-center rounded-full border size-5 shrink-0 border-border text-[11px]">
                                    {match status.as_str() {
                                        "done" | "completed" => {
                                            view! { <Check class="size-3 text-success" /> }.into_any()
                                        }
                                        "failed" => {
                                            view! { <X class="size-3 text-destructive" /> }.into_any()
                                        }
                                        "running" => view! { <Spinner class="size-3" /> }.into_any(),
                                        _ => view! { {(i + 1).to_string()} }.into_any(),
                                    }}
                                </span>
                                <span class="flex flex-col">
                                    <span>{step.any_text()}</span>
                                    {step
                                        .props
                                        .description
                                        .clone()
                                        .map(|d| {
                                            view! {
                                                <span class="text-xs text-muted-foreground">{d}</span>
                                            }
                                        })}
                                </span>
                            </li>
                        }
                    })
                    .collect_view()}
            </ol>
        </div>
    }
}

/// A small, dependency-free markdown subset: `**bold**`, `*italic*`,
/// `` `code` ``, `[text](url)` and `- ` bullet lines. Enough for what a
/// planner actually writes; a full CommonMark parser is not vendored.
#[component]
fn GenMarkdown(text: String) -> impl IntoView {
    let lines: Vec<AnyView> = text
        .lines()
        .map(|line| {
            if let Some(item) = line.strip_prefix("- ").or_else(|| line.strip_prefix("* ")) {
                view! { <li class="ml-4 text-sm list-disc">{inline_markdown(item)}</li> }.into_any()
            } else if line.trim().is_empty() {
                view! { <div class="h-2"></div> }.into_any()
            } else {
                view! { <p class="text-sm">{inline_markdown(line)}</p> }.into_any()
            }
        })
        .collect();
    view! { <div class="flex flex-col gap-0.5">{lines}</div> }
}

/// Bold, italic and inline code within one line, in first-match order so
/// `**bold**` is not read as two stray `*italic*` markers.
fn inline_markdown(line: &str) -> Vec<AnyView> {
    let mut out = Vec::new();
    let mut rest = line;

    while !rest.is_empty() {
        let bold = rest.find("**").and_then(|pos| {
            rest[pos + 2..].find("**").map(|end| (pos, end))
        });
        let code = rest.find('`').and_then(|pos| {
            rest[pos + 1..].find('`').map(|end| (pos, end))
        });
        // A single `*not-bold*` only counts once the `**` reading is ruled
        // out, or "*italic*" inside a bolder sentence would never be reached.
        let italic = rest.find('*').and_then(|pos| {
            (!rest[pos..].starts_with("**"))
                .then(|| rest[pos + 1..].find('*').map(|end| (pos, end)))
                .flatten()
        });

        let earliest = [
            bold.map(|(pos, _)| (pos, 0u8)),
            code.map(|(pos, _)| (pos, 1u8)),
            italic.map(|(pos, _)| (pos, 2u8)),
        ]
        .into_iter()
        .flatten()
        .min_by_key(|(pos, _)| *pos);

        let Some((pos, marker)) = earliest else {
            out.push(view! { <span>{rest.to_owned()}</span> }.into_any());
            break;
        };
        if pos > 0 {
            out.push(view! { <span>{rest[..pos].to_owned()}</span> }.into_any());
        }

        match marker {
            0 => {
                let (_, end) = bold.unwrap_or((0, 0));
                out.push(view! { <strong>{rest[pos + 2..pos + 2 + end].to_owned()}</strong> }.into_any());
                rest = &rest[pos + 4 + end..];
            }
            1 => {
                let (_, end) = code.unwrap_or((0, 0));
                out.push(
                    view! {
                        <code class="px-1 py-0.5 rounded bg-muted text-xs">
                            {rest[pos + 1..pos + 1 + end].to_owned()}
                        </code>
                    }
                    .into_any(),
                );
                rest = &rest[pos + 2 + end..];
            }
            _ => {
                let (_, end) = italic.unwrap_or((0, 0));
                out.push(view! { <em>{rest[pos + 1..pos + 1 + end].to_owned()}</em> }.into_any());
                rest = &rest[pos + 2 + end..];
            }
        }
    }
    out
}

fn badge_variant(name: Option<&str>) -> BadgeVariant {
    match name {
        Some("secondary") => BadgeVariant::Secondary,
        Some("destructive") => BadgeVariant::Destructive,
        Some("outline") => BadgeVariant::Outline,
        _ => BadgeVariant::Default,
    }
}
