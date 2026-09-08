//! The left rail.
//!
//! Two headings rather than one divider, exactly as the Flutter rail does it:
//! the list mixes things Dex does *for* you with places you go to *look at*
//! something, and reading it as one list means reading all six every time to
//! find either.

use icons::{
    Clock, FilePlus, PanelLeft, Plug, Repeat, ScrollText, Settings, User,
};
use leptos::prelude::*;
use registry::ui::button::{Button, ButtonSize, ButtonVariant};
use registry::ui::dropdown_menu::{
    DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger,
};
use registry::ui::input::Input;
use registry::ui::scroll_area::ScrollArea;
use registry::ui::sidenav::{
    Sidenav, SidenavContent, SidenavFooter, SidenavGroup, SidenavGroupContent, SidenavGroupLabel,
    SidenavHeader, SidenavMenu, SidenavVariant,
};
use registry::ui::tooltip::{Tooltip, TooltipContent};

use crate::copy;
use crate::state::{Modal, use_app};

#[component]
pub fn Sidebar() -> impl IntoView {
    let app = use_app();
    let expanded = app.sidebar_expanded;
    let search = RwSignal::new(String::new());

    view! {
        // `Sidenav` sizes itself from the `--sidenav-width` custom property,
        // not from a `width` class — that was the earlier bug. Setting the
        // property here is enough: it inherits down to both the in-flow
        // spacer and the fixed rail the component renders internally, and
        // passing no `class` here (the earlier `w-full` clobbered the
        // component's own width utility, stretching it to the full window).
        <div style=move || {
            format!("--sidenav-width: {}", if expanded.get() { "280px" } else { "80px" })
        }>
        <Sidenav variant=SidenavVariant::Floating>
            <SidenavHeader class="flex-row gap-2 items-center">
                <span class="text-sm font-semibold" class:hidden=move || !expanded.get()>
                    "Dex"
                </span>
                <Tooltip class="ml-auto">
                    <Button
                        variant=ButtonVariant::Ghost
                        size=ButtonSize::IconSm
                        on:click=move |_| expanded.update(|e| *e = !*e)
                    >
                        <PanelLeft />
                    </Button>
                    <TooltipContent>
                        {move || {
                            if expanded.get() { copy::NAV_COLLAPSE } else { copy::NAV_EXPAND }
                        }}
                    </TooltipContent>
                </Tooltip>
            </SidenavHeader>

            <SidenavContent>
                <SidenavGroup>
                    <SidenavGroupContent>
                        <SidenavMenu>
                            <NavItem
                                label=copy::NAV_NEW_CHAT
                                expanded=expanded
                                on_click=Callback::new(move |()| app.new_conversation())
                            >
                                <FilePlus class="size-4" />
                            </NavItem>
                        </SidenavMenu>
                    </SidenavGroupContent>
                </SidenavGroup>

                <SidenavGroup>
                    <Show when=move || expanded.get()>
                        <SidenavGroupLabel>{copy::NAV_HEADING_AUTOMATE}</SidenavGroupLabel>
                    </Show>
                    <SidenavGroupContent>
                        <SidenavMenu>
                            <NavItem
                                label=copy::NAV_WORKFLOWS
                                expanded=expanded
                                on_click=Callback::new(move |()| {
                                    app.open(Modal::Settings("memory".to_owned()))
                                })
                            >
                                <Repeat class="size-4" />
                            </NavItem>
                            <NavItem
                                label=copy::NAV_SCHEDULES
                                expanded=expanded
                                on_click=Callback::new(move |()| app.open(Modal::Reminders))
                            >
                                <Clock class="size-4" />
                            </NavItem>
                        </SidenavMenu>
                    </SidenavGroupContent>
                </SidenavGroup>

                <SidenavGroup>
                    <Show when=move || expanded.get()>
                        <SidenavGroupLabel>{copy::NAV_HEADING_MACHINE}</SidenavGroupLabel>
                    </Show>
                    <SidenavGroupContent>
                        <SidenavMenu>
                            <NavItem
                                label=copy::NAV_CAPABILITIES
                                expanded=expanded
                                on_click=Callback::new(move |()| {
                                    app.open(Modal::Settings("connectors".to_owned()))
                                })
                            >
                                <Plug class="size-4" />
                            </NavItem>
                            <NavItem
                                label=copy::NAV_LOGS
                                expanded=expanded
                                on_click=Callback::new(move |()| {
                                    app.open(Modal::Settings("diagnostics".to_owned()))
                                })
                            >
                                <ScrollText class="size-4" />
                            </NavItem>
                            <NavItem
                                label=copy::NAV_SETTINGS
                                expanded=expanded
                                on_click=Callback::new(move |()| {
                                    app.open(Modal::Settings("intelligence".to_owned()))
                                })
                            >
                                <Settings class="size-4" />
                            </NavItem>
                        </SidenavMenu>
                    </SidenavGroupContent>
                </SidenavGroup>

                <Show when=move || expanded.get()>
                    <SidenavGroup class="min-h-0 grow">
                        <SidenavGroupLabel>{copy::NAV_HISTORY}</SidenavGroupLabel>
                        <SidenavGroupContent class="flex flex-col gap-2 min-h-0">
                            <Input
                                class="h-8"
                                attr:placeholder=copy::NAV_SEARCH_PLACEHOLDER
                                prop:value=move || search.get()
                                on:input=move |ev| {
                                    let query = event_target_value(&ev);
                                    search.set(query.clone());
                                    app.search_conversations(&query);
                                }
                            />
                            <ScrollArea class="min-h-0 grow">
                                <HistoryList />
                            </ScrollArea>
                        </SidenavGroupContent>
                    </SidenavGroup>
                </Show>
            </SidenavContent>

            <SidenavFooter>
                <DropdownMenu>
                    <DropdownMenuTrigger
                        class="flex gap-2 items-center p-2 w-full rounded-md hover:bg-sidenav-accent"
                        class:justify-center=move || !expanded.get()
                    >
                        <span class="flex justify-center items-center rounded-full size-7 bg-muted">
                            <User class="size-4" />
                        </span>
                        <Show when=move || expanded.get()>
                            <span class="text-sm truncate">{copy::SIDEBAR_USER}</span>
                        </Show>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent class="w-[200px]">
                        <DropdownMenuGroup>
                            {copy::PROFILE_MENU
                                .iter()
                                .map(|label| {
                                    let label = *label;
                                    view! {
                                        <DropdownMenuItem on:click=move |_| {
                                            match label {
                                                "Settings" => {
                                                    app.open(Modal::Settings("intelligence".to_owned()))
                                                }
                                                "Memory" => app.open(Modal::Settings("memory".to_owned())),
                                                "Reminders" => app.open(Modal::Reminders),
                                                // "Give feedback" and "Sign out" are
                                                // no-ops in the Flutter client too —
                                                // there is no account to sign out of.
                                                _ => app.notify("There is no Dex account to sign out of."),
                                            }
                                        }>{label}</DropdownMenuItem>
                                    }
                                })
                                .collect_view()}
                        </DropdownMenuGroup>
                    </DropdownMenuContent>
                </DropdownMenu>
            </SidenavFooter>
        </Sidenav>
        </div>
    }
}

#[component]
fn NavItem(
    #[prop(into)] label: &'static str,
    expanded: RwSignal<bool>,
    on_click: Callback<()>,
    children: Children,
) -> impl IntoView {
    view! {
        <Tooltip class="w-full">
            <button
                class="flex gap-2 items-center px-2 py-1.5 w-full text-sm rounded-md hover:bg-sidenav-accent hover:text-sidenav-accent-foreground"
                class:justify-center=move || !expanded.get()
                on:click=move |_| on_click.run(())
            >
                {children()}
                <Show when=move || expanded.get()>
                    <span class="truncate">{label}</span>
                </Show>
            </button>
            // The label is the whole affordance when the rail is collapsed.
            <Show when=move || !expanded.get()>
                <TooltipContent>{label}</TooltipContent>
            </Show>
        </Tooltip>
    }
}

/// Past conversations, bucketed by day.
#[component]
fn HistoryList() -> impl IntoView {
    let app = use_app();
    let conversations = Signal::derive(move || app.conversations());

    view! {
        <Show
            when=move || !conversations.get().is_empty()
            fallback=|| {
                view! {
                    <p class="px-2 py-1 text-xs text-muted-foreground">
                        "Nothing yet. Finish a task and it appears here."
                    </p>
                }
            }
        >
            <ul class="flex flex-col gap-0.5">
                {move || {
                    let items = conversations.get();
                    let mut bucket = "";
                    items
                        .into_iter()
                        .map(|row| {
                            let heading = (row.bucket != bucket).then(|| {
                                bucket = row.bucket;
                                row.bucket
                            });
                            let id = row.id.clone();
                            view! {
                                <>
                                    {heading
                                        .map(|name| {
                                            view! {
                                                <li class="px-2 pt-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                                    {name}
                                                </li>
                                            }
                                        })}
                                    <li>
                                        <button
                                            class="px-2 py-1.5 w-full text-sm text-left rounded-md truncate hover:bg-sidenav-accent"
                                            class:text-destructive=row.failed
                                            on:click=move |_| app.open_conversation(&id)
                                        >
                                            {row.title.clone()}
                                        </button>
                                    </li>
                                </>
                            }
                        })
                        .collect_view()
                }}
            </ul>
        </Show>
    }
}
