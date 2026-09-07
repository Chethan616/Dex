/plan see the file / flutter app folder in \DEXV3\app and take it as a reference on the APP flow NOT UI NOT UX and create a new app in sepetrate root folder of the project called "RUST-APP"

READ THIS FILE FULLY END TO END WORD TO WORD: \TOBEDONE.MD

follow these UI UX DESIGN STRICTLY and also make sure u get the quotes all the quotes from the Flutter APP as well
every part thats there in flutter app must be in the new rust app
 
Alert Dialog


use leptos::prelude::*;

use crate::ui::alert_dialog::{
    AlertDialog, AlertDialogBody, AlertDialogClose, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
    AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
};
use crate::ui::button::Button;

#[component]
pub fn DemoAlertDialog() -> impl IntoView {
    view! {
        <AlertDialog>
            <AlertDialogTrigger>Open Alert</AlertDialogTrigger>

            <AlertDialogContent class="w-[425px]">
                <AlertDialogBody>
                    <AlertDialogHeader>
                        <AlertDialogTitle>"Are you absolutely sure?"</AlertDialogTitle>

                        <AlertDialogDescription>
                            "This action cannot be undone. This will permanently delete your account and remove your data from our servers."
                        </AlertDialogDescription>
                    </AlertDialogHeader>

                    <AlertDialogFooter>
                        <AlertDialogClose class="w-full sm:w-fit">"Cancel"</AlertDialogClose>
                        <Button attr:r#type="submit" class="w-full sm:w-fit">
                            "Continue"
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogBody>
            </AlertDialogContent>
        </AlertDialog>
    }
}

------------------------------------------------------------

ui add demo_aspect_ratio

-------------------------------------------------------------

Attachment 

ui add demo_attachment
use icons::{FileCode, X};
use leptos::prelude::*;

use crate::ui::attachment::{
    Attachment, AttachmentAction, AttachmentActions, AttachmentContent, AttachmentDescription, AttachmentGroup,
    AttachmentMedia, AttachmentMediaVariant, AttachmentState, AttachmentTitle,
};
use crate::ui::spinner::Spinner;

#[component]
pub fn DemoAttachment() -> impl IntoView {
    view! {
        <div class="flex flex-col gap-3 py-12 mx-auto w-full max-w-sm">
            <AttachmentGroup>
                <Attachment orientation=crate::ui::attachment::AttachmentOrientation::Vertical>
                    <AttachmentMedia variant=AttachmentMediaVariant::Image>
                        <img
                            src="https://images.unsplash.com/photo-1497366754035-f200968a6e72?w=900&auto=format&fit=crop&q=80"
                            alt="Workspace"
                        />
                    </AttachmentMedia>
                    <AttachmentContent>
                        <AttachmentTitle>"workspace.png"</AttachmentTitle>
                        <AttachmentDescription>"PNG · 820 KB"</AttachmentDescription>
                    </AttachmentContent>
                </Attachment>
                <Attachment orientation=crate::ui::attachment::AttachmentOrientation::Vertical>
                    <AttachmentMedia variant=AttachmentMediaVariant::Image>
                        <img
                            src="https://images.unsplash.com/photo-1497215728101-856f4ea42174?w=900&auto=format&fit=crop&q=80"
                            alt="Desk"
                        />
                    </AttachmentMedia>
                    <AttachmentContent>
                        <AttachmentTitle>"desk-reference.jpg"</AttachmentTitle>
                        <AttachmentDescription>"JPG · 1.1 MB"</AttachmentDescription>
                    </AttachmentContent>
                </Attachment>
                <Attachment orientation=crate::ui::attachment::AttachmentOrientation::Vertical>
                    <AttachmentMedia variant=AttachmentMediaVariant::Image>
                        <img
                            src="https://images.unsplash.com/photo-1497366811353-6870744d04b2?w=900&auto=format&fit=crop&q=80"
                            alt="Office"
                        />
                    </AttachmentMedia>
                    <AttachmentContent>
                        <AttachmentTitle>"office-reference.jpg"</AttachmentTitle>
                        <AttachmentDescription>"JPG · 940 KB"</AttachmentDescription>
                    </AttachmentContent>
                </Attachment>
            </AttachmentGroup>
            <Attachment state=AttachmentState::Uploading class="w-full">
                <AttachmentMedia>
                    <Spinner />
                </AttachmentMedia>
                <AttachmentContent>
                    <AttachmentTitle>"sales-dashboard.pdf"</AttachmentTitle>
                    <AttachmentDescription>"Uploading · 64%"</AttachmentDescription>
                </AttachmentContent>
                <AttachmentActions>
                    <AttachmentAction attr:aria-label="Cancel upload">
                        <X />
                    </AttachmentAction>
                </AttachmentActions>
            </Attachment>
            <Attachment class="w-full">
                <AttachmentMedia>
                    <FileCode />
                </AttachmentMedia>
                <AttachmentContent>
                    <AttachmentTitle>"message-renderer.tsx"</AttachmentTitle>
                    <AttachmentDescription>"TypeScript · 12 KB"</AttachmentDescription>
                </AttachmentContent>
                <AttachmentActions>
                    <AttachmentAction attr:aria-label="Remove message-renderer.tsx">
                        <X />
                    </AttachmentAction>
                </AttachmentActions>
            </Attachment>
        </div>
    }
}

--------------------------------------------------------

ui add demo_auto_form

--------------------------------------------------------

ui add demo_badge

--------------------------------------------------------
ui add demo_breadcrumb
-------------------------------------------------------

ui add demo_bubble
use leptos::prelude::*;

use crate::ui::bubble::{Bubble, BubbleContent, BubbleGroup, BubbleReactions, BubbleVariant};

#[component]
pub fn DemoBubble() -> impl IntoView {
    view! {
        <div class="flex flex-col gap-8 py-12 w-full max-w-sm">
            <Bubble align=crate::ui::bubble::BubbleAlign::End>
                <BubbleContent>"Hey there! what's up?"</BubbleContent>
            </Bubble>
            <BubbleGroup>
                <Bubble variant=BubbleVariant::Muted>
                    <BubbleContent>"Hey! Want to see chat bubbles?"</BubbleContent>
                </Bubble>
                <Bubble variant=BubbleVariant::Muted>
                    <BubbleContent>
                        "I can group messages, switch sides, and keep the whole thread easy to scan."
                    </BubbleContent>
                    <BubbleReactions attr:role="img" attr:aria-label="Reaction: thumbs up">
                        <span>"👍"</span>
                    </BubbleReactions>
                </Bubble>
            </BubbleGroup>
            <Bubble align=crate::ui::bubble::BubbleAlign::End>
                <BubbleContent>"Sure. Hit me with your best demo."</BubbleContent>
            </Bubble>
            <Bubble variant=BubbleVariant::Muted>
                <BubbleContent>
                    "Yes. You are reading a demo that is demoing itself. Very meta. Very on-brand."
                </BubbleContent>
                <BubbleReactions attr:role="img" attr:aria-label="Reactions: thumbs up, fire, eyes, and 2 more">
                    <span>"👍"</span>
                    <span>"🔥"</span>
                    <span>"👀"</span>
                    <span>"+2"</span>
                </BubbleReactions>
            </Bubble>
        </div>
    }
}


implement this for chats even this ui add demo_message
use leptos::prelude::*;

use crate::ui::avatar::{Avatar, AvatarFallback, AvatarImage};
use crate::ui::bubble::{Bubble, BubbleContent, BubbleGroup, BubbleReactions, BubbleVariant};
use crate::ui::marker::{Marker, MarkerContent};
use crate::ui::message::{Message, MessageAlign, MessageAvatar, MessageContent, MessageFooter};

#[component]
pub fn DemoMessage() -> impl IntoView {
    view! {
        <div class="flex flex-col gap-6 py-12 w-full max-w-sm">
            <Message align=MessageAlign::End>
                <MessageAvatar>
                    <Avatar>
                        <AvatarImage attr:src="/avatars/10.png" attr:alt="@me" />
                        <AvatarFallback>"ME"</AvatarFallback>
                    </Avatar>
                </MessageAvatar>
                <MessageContent>
                    <Bubble>
                        <BubbleContent>"Deploying to prod real quick."</BubbleContent>
                    </Bubble>
                </MessageContent>
            </Message>
            <Message>
                <MessageAvatar>
                    <Avatar>
                        <AvatarImage attr:src="/avatars/02.png" attr:alt="@rabbit" />
                        <AvatarFallback>"R"</AvatarFallback>
                    </Avatar>
                </MessageAvatar>
                <MessageContent>
                    <Bubble variant=BubbleVariant::Muted>
                        <BubbleContent>"It's 4:55 PM. On a Friday."</BubbleContent>
                    </Bubble>
                </MessageContent>
            </Message>
            <Message align=MessageAlign::End>
                <MessageAvatar>
                    <Avatar>
                        <AvatarImage attr:src="/avatars/10.png" attr:alt="@me" />
                        <AvatarFallback>"ME"</AvatarFallback>
                    </Avatar>
                </MessageAvatar>
                <MessageContent>
                    <Bubble>
                        <BubbleContent>"It's a one-line change."</BubbleContent>
                    </Bubble>
                    <MessageFooter>"Delivered"</MessageFooter>
                </MessageContent>
            </Message>
            <Message>
                <MessageAvatar>
                    <Avatar>
                        <AvatarImage attr:src="/avatars/02.png" attr:alt="@rabbit" />
                        <AvatarFallback>"R"</AvatarFallback>
                    </Avatar>
                </MessageAvatar>
                <MessageContent>
                    <BubbleGroup>
                        <Bubble variant=BubbleVariant::Muted>
                            <BubbleContent>"It's always a one-line change 😭."</BubbleContent>
                        </Bubble>
                        <Bubble variant=BubbleVariant::Muted>
                            <BubbleContent>"Alright, let me take a look."</BubbleContent>
                            <BubbleReactions attr:aria-label="Reactions: thumbs up">
                                <span>"👍"</span>
                            </BubbleReactions>
                        </Bubble>
                    </BubbleGroup>
                </MessageContent>
            </Message>
            <Marker role="status">
                <MarkerContent class="shimmer">
                    <span class="font-medium">"Oliver"</span>
                    " is typing..."
                </MarkerContent>
            </Marker>
        </div>
    }
}

-----------------------------------------------------------

ui add demo_button
-----------------------------------------------------------
ui add demo_button_action this button for full access and important things
use icons::Trash2;
use leptos::prelude::*;

use crate::ui::button_action::ButtonAction;
use crate::ui::toast_custom::toast_wrapper::show_toast;

#[component]
pub fn DemoButtonAction() -> impl IntoView {
    let on_complete = Callback::new(move |_| {
        show_toast().success("Action completed!");
    });

    view! {
        <ButtonAction on_complete=on_complete duration_ms=2000>
            <Trash2 />
            <span>"Hold to Delete"</span>
        </ButtonAction>
    }
}

------------------------------------------------------------

ui add demo_button_group

use leptos::prelude::*;

use crate::ui::button::{Button, ButtonVariant};
use crate::ui::button_group::ButtonGroup;

#[component]
pub fn DemoButtonGroup() -> impl IntoView {
    view! {
        <ButtonGroup>
            <Button variant=ButtonVariant::Outline>"First"</Button>
            <Button variant=ButtonVariant::Outline>"Second"</Button>
            <Button variant=ButtonVariant::Outline>"Third"</Button>
        </ButtonGroup>
    }
}

if applicable
-------------------------------------------------------------

ui add demo_card_carousel

use icons::{ChevronLeft, ChevronRight};
use leptos::prelude::*;

use crate::ui::card::{CardContent, CardDescription, CardTitle};
use crate::ui::card_carousel::{
    CardCarousel, CardCarouselImage, CardCarouselIndicator, CardCarouselIndicators, CardCarouselNav,
    CardCarouselNavButton, CardCarouselOverlay, CardCarouselSlide, CardCarouselTrack,
};

/* ========================================================== */
/*                     ✨ FUNCTIONS ✨                        */
/* ========================================================== */

#[component]
pub fn DemoCardCarousel() -> impl IntoView {
    let images_count = IMAGES.len();

    view! {
        <div class="my-4">
            <CardCarousel>
                <CardCarouselOverlay>
                    <CardCarouselNav>
                        <CardCarouselNavButton attr:aria-disabled=true>
                            <ChevronLeft />
                        </CardCarouselNavButton>
                        <CardCarouselNavButton>
                            <ChevronRight />
                        </CardCarouselNavButton>
                    </CardCarouselNav>
                    <CardCarouselIndicators>
                        {(0..images_count)
                            .map(|i| {
                                view! { <CardCarouselIndicator attr:aria-current=move || i == 0 /> }
                            })
                            .collect_view()}
                    </CardCarouselIndicators>
                </CardCarouselOverlay>
                <CardCarouselTrack>
                    {IMAGES
                        .iter()
                        .map(|src| {
                            view! {
                                <CardCarouselSlide>
                                    <CardCarouselImage attr:src=*src attr:alt="CardCarousel img" />
                                </CardCarouselSlide>
                            }
                        })
                        .collect_view()}
                </CardCarouselTrack>
            </CardCarousel>

            <CardContent class="py-4">
                <CardTitle>"MV, Maldives"</CardTitle>
                <CardDescription>"4,843 kilometers away"</CardDescription>
                <CardDescription>"Aug 1 – 6"</CardDescription>
                <CardDescription>"$685 per night"</CardDescription>
            </CardContent>
        </div>
    }
}

/* ========================================================== */
/*                     ✨ CONSTANTS ✨                        */
/* ========================================================== */

const IMAGES: &[&str] = &[
    "https://a0.muscache.com/im/pictures/e24c13b9-dd2a-4e15-9845-dd588a884e39.jpg?im_w=720",
    "https://a0.muscache.com/im/pictures/373443ec-b377-4181-b753-3a2f3508c2b3.jpg?im_w=720",
    "https://a0.muscache.com/im/pictures/97b92645-f975-4e60-9ae0-205885af64b0.jpg?im_w=720",
    "https://a0.muscache.com/im/pictures/0089340a-409a-4fbe-9ab7-cb26884bf267.jpg?im_w=720",
    "https://a0.muscache.com/im/pictures/90e58fdf-257b-43a5-a6dc-a08f518397fe.jpg?im_w=720",
];


add this for displaying the artifacts when there are multiple ok? (by relevance)

-------------------------------------------

ui add demo_checkbox

use leptos::prelude::*;

use crate::ui::checkbox::Checkbox;
use crate::ui::label::Label;

#[component]
pub fn DemoCheckbox() -> impl IntoView {
    let item1_signal = RwSignal::new(true);
    let item2_signal = RwSignal::new(false);

    view! {
        <div class="flex flex-col gap-4">
            <div class="flex gap-2 items-center">
                <Checkbox
                    attr:id="item1"
                    checked=item1_signal
                    on_checked_change=Callback::new(move |checked| {
                        item1_signal.set(checked);
                    })
                />
                <Label html_for="item1">Item 1</Label>
            </div>
            <div class="flex gap-2 items-center">
                <Checkbox
                    attr:id="item2"
                    checked=item2_signal
                    on_checked_change=Callback::new(move |checked| {
                        item2_signal.set(checked);
                    })
                />
                <Label html_for="item2">Item 2</Label>
            </div>
            <div class="flex gap-2 items-center">
                <Checkbox attr:id="disabled1" checked=true disabled=true />
                <Label html_for="disabled1">Disabled</Label>
            </div>
            <div class="flex gap-2 items-center">
                <Checkbox attr:id="disabled2" disabled=true />
                <Label html_for="disabled2">Disabled</Label>
            </div>
        </div>
    }
}


this for task planning and completion and stuff even use this iff needed 
ui add demo_marker
use icons::{GitBranch, Search};
use leptos::prelude::*;

use crate::ui::marker::{Marker, MarkerContent, MarkerIcon, MarkerVariant};
use crate::ui::spinner::Spinner;

#[component]
pub fn DemoMarker() -> impl IntoView {
    view! {
        <div class="flex flex-col gap-8 py-12 w-full max-w-sm">
            <Marker>
                <MarkerIcon>
                    <GitBranch />
                </MarkerIcon>
                <MarkerContent>"Switched to a new branch"</MarkerContent>
            </Marker>
            <Marker role="status">
                <MarkerIcon>
                    <Spinner />
                </MarkerIcon>
                <MarkerContent class="shimmer">"Thinking..."</MarkerContent>
            </Marker>
            <Marker variant=MarkerVariant::Separator>
                <MarkerContent>"Conversation compacted"</MarkerContent>
            </Marker>
            <Marker>
                <MarkerIcon>
                    <Search />
                </MarkerIcon>
                <MarkerContent>"Explored 4 files"</MarkerContent>
            </Marker>
        </div>
    }
}

also this also for planning ui add demo_stepper
use leptos::prelude::*;

use crate::ui::stepper::{
    Stepper, StepperDescription, StepperIndicator, StepperItem, StepperSeparator, StepperTitle, StepperTrigger,
};

#[component]
pub fn DemoStepper() -> impl IntoView {
    view! {
        <Stepper total_steps=3 default_step=1 class="w-full max-w-md">
            <StepperItem step=0>
                <StepperTrigger>
                    <StepperIndicator />
                    <div class="flex flex-col gap-0.5 items-center text-center">
                        <StepperTitle>"Account"</StepperTitle>
                        <StepperDescription>"Create your account"</StepperDescription>
                    </div>
                </StepperTrigger>
                <StepperSeparator />
            </StepperItem>
            <StepperItem step=1>
                <StepperTrigger>
                    <StepperIndicator />
                    <div class="flex flex-col gap-0.5 items-center text-center">
                        <StepperTitle>"Profile"</StepperTitle>
                        <StepperDescription>"Complete your profile"</StepperDescription>
                    </div>
                </StepperTrigger>
                <StepperSeparator />
            </StepperItem>
            <StepperItem step=2>
                <StepperTrigger>
                    <StepperIndicator />
                    <div class="flex flex-col gap-0.5 items-center text-center">
                        <StepperTitle>"Confirmation"</StepperTitle>
                        <StepperDescription>"Review and confirm"</StepperDescription>
                    </div>
                </StepperTrigger>
            </StepperItem>
        </Stepper>
    }
}


in a neat structured way ok? idk what u will do i need feature and UI UX RICH PLANNING UI UX



----------------------------------------------------------

ui add demo_chips 

use leptos::prelude::*;

use crate::ui::chips::{ChipItem, ChipsContainer};

#[component]
pub fn DemoChips() -> impl IntoView {
    view! {
        <ChipsContainer>
            <ChipItem label="sunny" />
            <ChipItem label="cloudy" />
            <ChipItem label="rainy" />
            <ChipItem label="windy" />
            <ChipItem label="stormy" />
            <ChipItem label="foggy" />
            <ChipItem label="snowy" />
            <ChipItem label="icy" />
            <ChipItem label="humid" />
            <ChipItem label="dry" />
            <ChipItem label="hot" />
            <ChipItem label="cold" />
            <ChipItem label="warm" />
            <ChipItem label="chilly" />
            <ChipItem label="breezy" />
            <ChipItem label="gusty" />
            <ChipItem label="hazy" />
        </ChipsContainer>
    }
}


for like slash commands like when type /plan anywhere it should insert this ship ininpuit feild 
------------------------------------------------------------

ui add demo_collapsible if applicable
-------------------------------------

ui add demo_combobox

use icons::{ChevronsUpDown, Search};
use leptos::prelude::*;
use strum::{Display, EnumIter, IntoEnumIterator};

use crate::ui::command::{Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList};
use crate::ui::popover::{Popover, PopoverAlign, PopoverContent, PopoverTrigger};

/* ========================================================== */
/*                     ✨ FUNCTIONS ✨                        */
/* ========================================================== */

#[derive(Debug, Clone, Copy, PartialEq, Eq, Display, EnumIter)]
enum Language {
    Rust,
    JavaScript,
    Ruby,
    Python,
}

#[component]
pub fn DemoCombobox() -> impl IntoView {
    let value_signal = RwSignal::new(None::<Language>);

    view! {
        <Popover align=PopoverAlign::Start>
            <PopoverTrigger class="justify-between w-[200px]">
                <span class="truncate">
                    {move || value_signal.get().map(|l| l.to_string()).unwrap_or_else(|| "Select language...".into())}
                </span>
                <ChevronsUpDown class="ml-auto opacity-50 size-4" />
            </PopoverTrigger>

            <PopoverContent class="p-0 w-[200px]">
                <Command>
                    <div class="flex gap-2 items-center px-2 border-b">
                        <Search class="size-4 text-muted-foreground shrink-0" />
                        <CommandInput attr:placeholder="Search language..." />
                    </div>
                    <CommandList class="min-h-0">
                        <CommandEmpty>"No language found."</CommandEmpty>
                        <CommandGroup>
                            {Language::iter()
                                .map(|language| {
                                    let label = language.to_string();
                                    let is_selected = Signal::derive(move || value_signal.get() == Some(language));
                                    view! {
                                        <CommandItem
                                            value=label.clone()
                                            selected=is_selected
                                            on_select=Callback::new(move |_| {
                                                value_signal.set(Some(language));
                                            })
                                        >
                                            {label}
                                        </CommandItem>
                                    }
                                })
                                .collect_view()}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    }
}

if applicable 
---------------------
ui add demo_command if applicable
-----------------------

ui add demo_data_grid when it wants to generate structured table or smthing like that kind of like Generative UI
ui add demo_data_grid but hardcoded 
use std::collections::HashSet;
use std::sync::LazyLock;

use icons::{Copy, Eraser, Plus, Scissors, Settings2, Trash2};
use leptos::prelude::*;
use serde::{Deserialize, Serialize};
use strum::{AsRefStr, Display, EnumIter, IntoEnumIterator};

use crate::hooks::use_cell_edit::use_cell_edit;
use crate::hooks::use_column_state::{ColumnState, use_column_state};
use crate::hooks::use_copy_clipboard::use_copy_clipboard;
use crate::hooks::use_data_grid_state::{DataGridState, use_data_grid_state};
use crate::hooks::use_press_hold::use_press_hold;
use crate::ui::badge::{Badge, BadgeVariant};
use crate::ui::checkbox::Checkbox;
use crate::ui::context_menu::{
    ContextMenu, ContextMenuAction, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuTrigger,
};
use crate::ui::data_grid::{
    DataGridColumn, DataGridToolbar, EditableCellContent, Grid, GridBody, GridCell, GridCellWrapper, GridHeaderCell,
    GridPinnedCell, GridPinnedHeaderCell, GridRow, GridSelectCell, GridSelectHeaderCell, GridWrapper, PinnableColumn,
    PinnableSortableHeaderCell, SortDirection, SortableColumn, generate_grid_style, get_column_width,
    get_pinned_left_position, get_pinned_visible_columns,
};
use crate::ui::multi_select::{
    MultiSelect, MultiSelectAlign, MultiSelectContent, MultiSelectGroup, MultiSelectItem, MultiSelectOption,
    MultiSelectTrigger,
};
use crate::ui::separator::Separator;
use crate::ui::toast_custom::toaster::expect_toaster;

/* ========================================================== */
/*                     ✨ TYPES ✨                            */
/* ========================================================== */

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Display, AsRefStr, EnumIter)]
#[strum(serialize_all = "title_case")]
pub enum Column {
    Select,
    Name,
    Age,
    Email,
    Website,
    Notes,
    Salary,
    Department,
    Status,
    Skills,
    IsActive,
    StartDate,
    Attachments,
}

impl DataGridColumn for Column {
    fn colindex(self) -> i32 {
        self as i32 + 1
    }

    fn is_disabled(self) -> bool {
        matches!(self, Self::Select | Self::Name | Self::Email)
    }
}

impl SortableColumn<RowData> for Column {
    fn compare(self, a: &RowData, b: &RowData) -> Option<std::cmp::Ordering> {
        match self {
            Self::Name => Some(a.name.cmp(&b.name)),
            Self::Age => Some(a.age.cmp(&b.age)),
            Self::Email => Some(a.email.cmp(&b.email)),
            Self::Website => Some(a.website.cmp(&b.website)),
            Self::Notes => Some(a.notes.cmp(&b.notes)),
            Self::Salary => Some(a.salary.cmp(&b.salary)),
            Self::Department => Some(a.department.cmp(&b.department)),
            Self::Status => Some(a.status.cmp(&b.status)),
            Self::Skills => Some(a.skills.len().cmp(&b.skills.len())),
            Self::IsActive => Some(a.is_active.cmp(&b.is_active)),
            Self::StartDate => Some(a.start_date.cmp(&b.start_date)),
            Self::Select | Self::Attachments => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct RowData {
    pub name: String,
    pub age: i32,
    pub email: String,
    pub website: String,
    pub notes: String,
    pub salary: i32,
    pub department: String,
    pub status: String,
    pub skills: Vec<String>,
    pub is_active: bool,
    pub start_date: String,
}

/// Pinnable columns with their widths in order they should appear when pinned
const PINNABLE_COLUMNS: &[(Column, i32)] = &[
    (Column::Name, 180),
    (Column::Age, 150),
    (Column::Email, 240),
    (Column::Website, 240),
    (Column::Notes, 200),
    (Column::Salary, 180),
    (Column::Department, 180),
    (Column::Status, 180),
    (Column::Skills, 240),
    (Column::IsActive, 110),
    (Column::StartDate, 150),
    (Column::Attachments, 240),
];

impl PinnableColumn for Column {
    fn pinnable_columns() -> &'static [(Self, i32)] {
        PINNABLE_COLUMNS
    }
}

impl Column {
    fn wrapper_class(self) -> &'static str {
        match self {
            Self::IsActive => "flex justify-center",
            _ => "",
        }
    }

    fn get_value(self, row: &RowData) -> String {
        match self {
            Self::Name => row.name.clone(),
            Self::Age => row.age.to_string(),
            Self::Email => row.email.clone(),
            Self::Website => row.website.clone(),
            Self::Notes => row.notes.clone(),
            Self::Salary => row.salary.to_string(),
            Self::Department => row.department.clone(),
            Self::Status => row.status.clone(),
            Self::Skills => row.skills.join(", "),
            Self::IsActive => row.is_active.to_string(),
            Self::StartDate => row.start_date.clone(),
            Self::Select | Self::Attachments => String::new(),
        }
    }
}

/// CSS custom properties for column sizes, generated from PINNABLE_COLUMNS.
static GRID_STYLE: LazyLock<String> = LazyLock::new(generate_grid_style::<Column>);

/* ========================================================== */
/*                     ✨ SERVER FUNCTION ✨                  */
/* ========================================================== */

#[server]
pub async fn get_data_grid_rows() -> Result<Vec<RowData>, ServerFnError> {
    // Simulate server-side data fetching
    let rows = vec![
        RowData {
            name: "Toby Deckow".to_string(),
            age: 50,
            email: "toby.deckow32@yahoo.com".to_string(),
            website: "https://young-plain.net".to_string(),
            notes: "Relocated from the Seattle office last month. Adjusting well to the new team dynamics and company culture.".to_string(),
            salary: 42953,
            department: "Finance".to_string(),
            status: "In Office".to_string(),
            skills: vec!["Docker".to_string(), "JavaScript".to_string(), "SQL".to_string()],
            is_active: true,
            start_date: "12/13/2020".to_string(),
        },
        RowData {
            name: "Montserrat Kutch".to_string(),
            age: 52,
            email: "montserrat_kutch@yahoo.com".to_string(),
            website: "https://major-footrest.net".to_string(),
            notes: "Transferred from the marketing department. Bringing valuable cross-functional experience to the team.".to_string(),
            salary: 64820,
            department: "Marketing".to_string(),
            status: "In Office".to_string(),
            skills: vec!["AWS".to_string(), "Git".to_string(), "SQL".to_string(), "React".to_string()],
            is_active: true,
            start_date: "6/28/2023".to_string(),
        },
        RowData {
            name: "Alice Chen".to_string(),
            age: 34,
            email: "alice.chen@gmail.com".to_string(),
            website: "https://devblog-alice.io".to_string(),
            notes: "Senior developer with expertise in distributed systems. Leading the backend migration project.".to_string(),
            salary: 95000,
            department: "Engineering".to_string(),
            status: "Remote".to_string(),
            skills: vec!["Rust".to_string(), "Kubernetes".to_string(), "PostgreSQL".to_string(), "Go".to_string()],
            is_active: true,
            start_date: "3/15/2019".to_string(),
        },
        RowData {
            name: "James Rodriguez".to_string(),
            age: 28,
            email: "j.rodriguez@company.com".to_string(),
            website: "https://jamesux.design".to_string(),
            notes: "UI/UX designer focused on accessibility and user research. Recently completed design system overhaul.".to_string(),
            salary: 72500,
            department: "Design".to_string(),
            status: "Hybrid".to_string(),
            skills: vec!["Figma".to_string(), "CSS".to_string(), "TypeScript".to_string()],
            is_active: false,
            start_date: "9/01/2022".to_string(),
        },
    ];

    Ok(rows)
}

#[component]
pub fn DemoDataGrid() -> impl IntoView {
    view! { <DataGridFull /> }
}

/* ========================================================== */
/*                     ✨ FUNCTIONS ✨                        */
/* ========================================================== */

#[component]
pub fn DataGridFull() -> impl IntoView {
    let rows_resource = Resource::new(|| (), |_| async move { get_data_grid_rows().await });
    let rows_signal = RwSignal::new(Vec::<RowData>::new());

    let selected_indices_signal = RwSignal::new(HashSet::<usize>::new());

    let ColumnState { sort_signals, pinned_columns_signal, visible_columns_signal } =
        use_column_state(PINNABLE_COLUMNS);

    // Grid state (cell selection, drag selection, click outside)
    let DataGridState { cell_selection, drag_selection, copy_value_signal, grid_wrapper_ref } =
        use_data_grid_state::<Column>();

    // Copy to clipboard
    let (copy_to_clipboard, _) = use_copy_clipboard(None);
    let copy_to_clipboard = StoredValue::new(copy_to_clipboard);

    // Cell edit hook (double-click to edit)
    let _cell_edit = use_cell_edit::<Column>();

    // Create sorted rows memo
    let sorted_rows_signal = Memo::new(move |_| {
        let mut rows: Vec<RowData> = rows_signal.get();

        // Apply sorting in order (last one with a value takes precedence)
        sort_signals.with_value(|signals| {
            for (col, _) in PINNABLE_COLUMNS {
                if let Some(signal) = signals.get(col) {
                    col.sort_rows(&mut rows, signal.get());
                }
            }
        });

        rows
    });

    let row_count_signal = Signal::derive(move || rows_signal.with(|rows| rows.len()));

    // Dynamic height for virtual scrolling: (row_count + 1) * 36px to include add row button
    let grid_body_height = Signal::derive(move || {
        let row_count = row_count_signal.get();
        format!("height: {}px", (row_count + 1) * 36)
    });

    let selected_count_signal = Signal::derive(move || selected_indices_signal.with(|selected| selected.len()));

    let handle_select_all = Callback::new(move |checked: bool| {
        let row_count = row_count_signal.get();
        selected_indices_signal.update(|selected| {
            if checked {
                for index in 0..row_count {
                    selected.insert(index);
                }
            } else {
                selected.clear();
            }
        });
    });

    // Delete rows handler (swap this for server action when using real DB)
    let handle_delete_rows = Callback::new(move |names: Vec<String>| {
        rows_signal.update(|rows| {
            rows.retain(|r| !names.contains(&r.name));
        });
    });

    view! {
        <div class="container flex flex-col py-4">
            <ToolbarDataGrid visible_columns_signal />

            <Transition fallback=move || {
                view! { <p class="text-gray-500">"Loading data..."</p> }
            }>
                {move || {
                    rows_resource
                        .get()
                        .map(|result| {
                            match result {
                                Ok(rows) => {
                                    rows_signal.set(rows);
                                    view! {
                                        <div
                                            node_ref=grid_wrapper_ref
                                            on:mouseup=move |_| drag_selection.stop_dragging()
                                            on:mouseleave=move |_| drag_selection.stop_dragging()
                                        >
                                            <GridWrapper>
                                                <button
                                                    type="button"
                                                    id="radix-_R_mlubsqlb_"
                                                    aria-haspopup="menu"
                                                    aria-expanded="false"
                                                    data-state="closed"
                                                    data-slot="dropdown-menu-trigger"
                                                    style="position:fixed;left:0px;top:0px;width:1px;height:1px;padding:0;margin:0;border:none;background:transparent;pointer-events:none;opacity:0"
                                                ></button>
                                                <Grid
                                                    rowcount=Signal::derive(move || {
                                                        i32::try_from(row_count_signal.get()).unwrap_or(0) + 1
                                                    })
                                                    colcount=i32::try_from(Column::iter().count()).unwrap_or(0)
                                                    style=GRID_STYLE.as_str()
                                                >
                                                    // ------------- GRID HEADER ----------- //
                                                    <GridHeaderDataGrid
                                                        row_count_signal
                                                        selected_count_signal
                                                        handle_select_all
                                                        sort_signals
                                                        pinned_columns_signal
                                                        visible_columns_signal
                                                    />

                                                    // ------------- GRID BODY ----------- //
                                                    <GridBody style=grid_body_height>
                                                        <For
                                                            each=move || sorted_rows_signal.get()
                                                            key=|row| row.name.clone()
                                                            children=move |row| {
                                                                let row_name = row.name.clone();
                                                                let index = Signal::derive(move || {
                                                                    sorted_rows_signal
                                                                        .with(|rows| {
                                                                            rows.iter().position(|r| r.name == row_name).unwrap_or(0)
                                                                        })
                                                                });
                                                                let rowindex = Signal::derive(move || index.get() + 2);
                                                                let is_active_signal = RwSignal::new(row.is_active);
                                                                let is_selected = Signal::derive(move || {
                                                                    selected_indices_signal
                                                                        .with(|selected| selected.contains(&index.get()))
                                                                });
                                                                let row = StoredValue::new(row);
                                                                let render_cell_content = move |col: Column| -> AnyView {
                                                                    match col {
                                                                        Column::Website => {
                                                                            let url = row.with_value(|r| r.website.clone());
                                                                            let url_display = url.clone();
                                                                            // Derive index reactively so it updates when rows are deleted
                                                                            // Custom rendering: Website (link), Skills (badges), IsActive (checkbox)
                                                                            // Default: all other columns use GridCellContent with col.get_value()
                                                                            view! {
                                                                                <div
                                                                                    data-slot="grid-cell-content"
                                                                                    class="overflow-hidden size-full"
                                                                                >
                                                                                    <a
                                                                                        href=url
                                                                                        target="_blank"
                                                                                        rel="noopener noreferrer"
                                                                                        class="underline truncate text-primary decoration-primary/30 underline-offset-2 hover:decoration-primary/60"
                                                                                    >
                                                                                        {url_display}
                                                                                    </a>
                                                                                </div>
                                                                            }
                                                                                .into_any()
                                                                        }
                                                                        Column::Skills => {
                                                                            view! {
                                                                                <div class="flex overflow-hidden flex-wrap gap-1 items-center">
                                                                                    {row
                                                                                        .with_value(|r| r.skills.clone())
                                                                                        .into_iter()
                                                                                        .map(|skill| {
                                                                                            view! {
                                                                                                <Badge variant=BadgeVariant::Secondary>{skill}</Badge>
                                                                                            }
                                                                                        })
                                                                                        .collect_view()}
                                                                                </div>
                                                                            }
                                                                                .into_any()
                                                                        }
                                                                        Column::IsActive => {
                                                                            view! {
                                                                                <Checkbox
                                                                                    checked=is_active_signal
                                                                                    on_checked_change=Callback::new(move |checked| {
                                                                                        is_active_signal.set(checked)
                                                                                    })
                                                                                    aria_label="Active"
                                                                                />
                                                                            }
                                                                                .into_any()
                                                                        }
                                                                        Column::Select | Column::Attachments => {
                                                                            view! { <div /> }.into_any()
                                                                        }
                                                                        _ => {
                                                                            let value = row.with_value(|r| col.get_value(r));
                                                                            view! {
                                                                                <EditableCellContent
                                                                                    row_idx=index.get()
                                                                                    col=col
                                                                                    value=value
                                                                                />
                                                                            }
                                                                                .into_any()
                                                                        }
                                                                    }
                                                                };

                                                                // rowindex starts at 2 because row 1 is the header
                                                                view! {
                                                                    <ContextMenu>
                                                                        <ContextMenuTrigger>
                                                                            <GridRow rowindex=rowindex.get() index=index>
                                                                                <GridSelectCell>
                                                                                    <div class="py-1.5 px-3 size-full">
                                                                                        <Checkbox
                                                                                            checked=is_selected
                                                                                            on_checked_change=Callback::new(move |checked| {
                                                                                                let idx = index.get();
                                                                                                selected_indices_signal
                                                                                                    .update(|selected| {
                                                                                                        if checked {
                                                                                                            selected.insert(idx);
                                                                                                        } else {
                                                                                                            selected.remove(&idx);
                                                                                                        }
                                                                                                    });
                                                                                            })
                                                                                            aria_label="Select row"
                                                                                        />
                                                                                    </div>
                                                                                </GridSelectCell>
                                                                                // Pinned cells (dynamic loop) - only show if both pinned AND visible
                                                                                <For
                                                                                    each=move || get_pinned_visible_columns(
                                                                                        pinned_columns_signal,
                                                                                        visible_columns_signal,
                                                                                    )
                                                                                    key=|(col, _)| *col
                                                                                    children=move |(col, _width)| {
                                                                                        view! {
                                                                                            <GridPinnedCell
                                                                                                col=col
                                                                                                pinned_columns_signal=pinned_columns_signal
                                                                                            >
                                                                                                <GridCellWrapper class=col
                                                                                                    .wrapper_class()>
                                                                                                    {render_cell_content(col)}
                                                                                                </GridCellWrapper>
                                                                                            </GridPinnedCell>
                                                                                        }
                                                                                            .into_any()
                                                                                    }
                                                                                />
                                                                                // Non-pinned cells (dynamic loop)
                                                                                <For
                                                                                    each=move || { PINNABLE_COLUMNS.to_vec() }
                                                                                    key=|(col, _)| *col
                                                                                    children=move |(col, _width)| {
                                                                                        view! {
                                                                                            <GridCell
                                                                                                colindex=col.colindex()
                                                                                                column=col.css_safe_name()
                                                                                                visible=col
                                                                                                    .is_visible(pinned_columns_signal, visible_columns_signal)
                                                                                                active=Signal::derive(move || {
                                                                                                    cell_selection.is_active(index.get(), col)
                                                                                                })
                                                                                                current=Signal::derive(move || {
                                                                                                    cell_selection.is_context_menu(index.get(), col)
                                                                                                })
                                                                                                in_range=Signal::derive(move || {
                                                                                                    drag_selection.is_cell_in_range(index.get(), col)
                                                                                                })
                                                                                                on_click=Callback::new(move |_| {
                                                                                                    cell_selection.handle_click(index.get(), col);
                                                                                                    drag_selection.clear_selection();
                                                                                                })
                                                                                                on_contextmenu=Callback::new(move |_| {
                                                                                                    cell_selection.start_contextmenu();
                                                                                                    if drag_selection.handle_contextmenu(index.get(), col) {
                                                                                                        cell_selection.set_active(index.get(), col);
                                                                                                    }
                                                                                                    cell_selection.set_context_menu(index.get(), col);
                                                                                                    let value = row.with_value(|r| col.get_value(r));
                                                                                                    copy_value_signal.set(value);
                                                                                                })
                                                                                                on_mousedown=Callback::new(move |_| {
                                                                                                    cell_selection.set_active(index.get(), col);
                                                                                                    drag_selection.start_drag(index.get(), col);
                                                                                                })
                                                                                                on_mouseenter=Callback::new(move |_| {
                                                                                                    drag_selection.update_drag(index.get(), col);
                                                                                                })
                                                                                            >
                                                                                                <GridCellWrapper class=col
                                                                                                    .wrapper_class()>
                                                                                                    {render_cell_content(col)}
                                                                                                </GridCellWrapper>
                                                                                            </GridCell>
                                                                                        }
                                                                                            .into_any()
                                                                                    }
                                                                                />
                                                                            </GridRow>
                                                                        </ContextMenuTrigger>
                                                                        // Clear cell highlights when context menu closes (unless reopening on another cell)
                                                                        <ContextMenuContent on_close=Callback::new(move |_| {
                                                                            cell_selection.handle_contextmenu_close();
                                                                        })>
                                                                            <ContextMenuGroup>
                                                                                <ContextMenuItem on:click=move |_| {
                                                                                    let value = drag_selection
                                                                                        .collect_selection_values(
                                                                                            &sorted_rows_signal.get(),
                                                                                            PINNABLE_COLUMNS,
                                                                                            |row, col| col.get_value(row),
                                                                                        )
                                                                                        .unwrap_or_else(|| copy_value_signal.get());
                                                                                    if !value.is_empty() {
                                                                                        copy_to_clipboard.with_value(|copy_fn| copy_fn(&value));
                                                                                        expect_toaster().success("Copied to clipboard");
                                                                                    }
                                                                                }>
                                                                                    <ContextMenuAction>
                                                                                        <Copy />
                                                                                        <span>"Copy"</span>
                                                                                    </ContextMenuAction>
                                                                                </ContextMenuItem>
                                                                                <ContextMenuItem>
                                                                                    <ContextMenuAction>
                                                                                        <Scissors />
                                                                                        <span>"Cut"</span>
                                                                                    </ContextMenuAction>
                                                                                </ContextMenuItem>
                                                                                <ContextMenuItem>
                                                                                    <ContextMenuAction>
                                                                                        <Eraser />
                                                                                        <span>"Clear"</span>
                                                                                    </ContextMenuAction>
                                                                                </ContextMenuItem>
                                                                            </ContextMenuGroup>
                                                                            <Separator class="my-1" />
                                                                            <ContextMenuItem class="p-0">
                                                                                <PressHoldDeleteRow
                                                                                    index=index
                                                                                    drag_selection=drag_selection
                                                                                    cell_selection=cell_selection
                                                                                    sorted_rows_signal=sorted_rows_signal
                                                                                    handle_delete_rows=handle_delete_rows
                                                                                />
                                                                            </ContextMenuItem>
                                                                        </ContextMenuContent>
                                                                    </ContextMenu>
                                                                }
                                                            }
                                                        />
                                                        // Add row button at the bottom
                                                        <GridAddRow rows_signal row_count_signal />
                                                    </GridBody>
                                                </Grid>
                                            </GridWrapper>
                                        </div>
                                    }
                                        .into_any()
                                }
                                Err(err) => {
                                    view! {
                                        <div class="py-3 px-4 text-red-700 bg-red-100 rounded border border-red-400">
                                            <p class="font-medium">"Error loading data: " {err.to_string()}</p>
                                        </div>
                                    }
                                        .into_any()
                                }
                            }
                        })
                }}
            </Transition>
        </div>
    }
}

/* ========================================================== */
/*                     ✨ FUNCTIONS ✨                        */
/* ========================================================== */

#[component]
pub fn ToolbarDataGrid(visible_columns_signal: RwSignal<HashSet<String>>) -> impl IntoView {
    view! {
        <DataGridToolbar class="justify-end">
            // Column visibility multi-select
            <MultiSelect values=visible_columns_signal align=MultiSelectAlign::End>
                <MultiSelectTrigger>
                    <Settings2 class="text-muted-foreground" />
                    <span>"View"</span>
                </MultiSelectTrigger>
                <MultiSelectContent>
                    <MultiSelectGroup>
                        {Column::iter()
                            .filter(|c| *c != Column::Select)
                            .map(|column| {
                                let column_str = column.to_string();
                                let is_disabled = column.is_disabled();
                                view! {
                                    <MultiSelectItem>
                                        <MultiSelectOption value=column_str.clone() attr:disabled=is_disabled>
                                            {column_str}
                                        </MultiSelectOption>
                                    </MultiSelectItem>
                                }
                            })
                            .collect_view()}
                    </MultiSelectGroup>
                </MultiSelectContent>
            </MultiSelect>
        </DataGridToolbar>
    }
}

#[component]
pub fn GridHeaderDataGrid(
    row_count_signal: Signal<usize>,
    selected_count_signal: Signal<usize>,
    handle_select_all: Callback<bool>,
    sort_signals: StoredValue<std::collections::HashMap<Column, RwSignal<SortDirection>>>,
    pinned_columns_signal: RwSignal<HashSet<Column>>,
    visible_columns_signal: RwSignal<HashSet<String>>,
) -> impl IntoView {
    view! {
        <div role="rowgroup" data-slot="grid-header" class="grid sticky top-0 z-10 border-b bg-background">
            <div role="row" aria-rowindex="1" data-slot="grid-header-row" tabindex="-1" class="flex w-full">
                <GridSelectHeaderCell>
                    <div class="py-1.5 px-3 size-full">
                        <Checkbox
                            checked=Signal::derive(move || {
                                let row_count = row_count_signal.get();
                                row_count > 0 && selected_count_signal.get() == row_count
                            })
                            on_checked_change=handle_select_all
                            aria_label="Select all"
                        />
                    </div>
                </GridSelectHeaderCell>
                // Pinned headers (dynamic loop) - only show if both pinned AND visible
                <For
                    each=move || get_pinned_visible_columns(pinned_columns_signal, visible_columns_signal)
                    key=|(col, _)| *col
                    children=move |(col, _width)| {
                        let sort_signal = sort_signals.with_value(|s| s.get(&col).copied());
                        let Some(sort_signal) = sort_signal else {
                            return view! { <div></div> }.into_any();
                        };
                        let left = pinned_columns_signal.with(|p| get_pinned_left_position(col, p));
                        let width = get_column_width(col);

                        view! {
                            <GridPinnedHeaderCell left=left width=width>
                                <PinnableSortableHeaderCell
                                    column=col
                                    label=col.to_string()
                                    sort_signal=sort_signal
                                    pinned_columns_signal=pinned_columns_signal
                                    visible_columns_signal=visible_columns_signal
                                    is_pinned=true
                                />
                            </GridPinnedHeaderCell>
                        }
                            .into_any()
                    }
                />
                // Non-pinned headers (dynamic loop)
                <For
                    each=move || PINNABLE_COLUMNS.to_vec()
                    key=|(col, _)| *col
                    children=move |(col, _width)| {
                        let sort_signal = sort_signals.with_value(|s| s.get(&col).copied());
                        let Some(sort_signal) = sort_signal else {
                            return view! { <div></div> }.into_any();
                        };
                        view! {
                            <GridHeaderCell
                                colindex=col.colindex()
                                column=col.css_safe_name()
                                visible=col.is_visible(pinned_columns_signal, visible_columns_signal)
                            >
                                <PinnableSortableHeaderCell
                                    column=col
                                    label=col.to_string()
                                    sort_signal=sort_signal
                                    pinned_columns_signal=pinned_columns_signal
                                    visible_columns_signal=visible_columns_signal
                                />
                            </GridHeaderCell>
                        }
                            .into_any()
                    }
                />
            // grid-header-row
            </div>
        </div>
    }
}

#[component]
fn PressHoldDeleteRow(
    index: Signal<usize>,
    drag_selection: crate::hooks::use_drag_selection::UseDragSelection<Column>,
    cell_selection: crate::hooks::use_cell_selection::UseCellSelection<Column>,
    sorted_rows_signal: Memo<Vec<RowData>>,
    handle_delete_rows: Callback<Vec<String>>,
) -> impl IntoView {
    let on_delete = Callback::new(move |_| {
        let idx = index.get();
        let (min_row, max_row) =
            drag_selection.get_selection_bounds().map(|(min, max, _, _)| (min, max)).unwrap_or((idx, idx));

        let sorted = sorted_rows_signal.get();
        let names_to_delete: Vec<String> =
            (min_row..=max_row).filter_map(|i| sorted.get(i).map(|r| r.name.clone())).collect();

        let count = names_to_delete.len();
        handle_delete_rows.run(names_to_delete);
        drag_selection.clear_selection();
        cell_selection.clear_all();

        let suffix = if count == 1 { "" } else { "s" };
        expect_toaster().success(format!("Deleted {} row{}", count, suffix));
    });

    let disabled = Signal::derive(|| false);
    let press_hold = use_press_hold(1500, on_delete, disabled);

    let ph1 = press_hold.clone();
    let ph2 = press_hold.clone();
    let ph3 = press_hold.clone();
    let ph4 = press_hold.clone();

    let progress_style = move || {
        let width_percent = press_hold.progress_signal.get() * 100.0;
        format!(
            "position: absolute; left: 0; top: 0; bottom: 0; width: {width_percent:.1}%; background: rgba(239, 68, 68, 0.3); pointer-events: none; border-radius: inherit;"
        )
    };

    let is_multi_row =
        move || drag_selection.get_selection_bounds().is_some_and(|(min_row, max_row, _, _)| max_row > min_row);

    view! {
        <button
            class="flex relative gap-2 items-center py-1.5 px-2 w-full text-sm rounded-sm transition-colors select-none text-destructive hover:bg-destructive/10"
            on:pointerdown=move |_| ph1.on_pointer_down()
            on:pointerup=move |_| ph2.on_pointer_up()
            on:pointerleave=move |_| ph3.on_pointer_up()
            on:pointercancel=move |_| ph4.on_pointer_up()
        >
            <span style=progress_style></span>
            <span class="flex relative z-10 gap-2 items-center">
                <Trash2 class="size-4" />
                {move || if is_multi_row() { "Hold to delete rows" } else { "Hold to delete row" }}
            </span>
        </button>
    }
}

/* ========================================================== */
/*                     ✨ FUNCTIONS ✨                        */
/* ========================================================== */

/// Add row button at the bottom of the grid using absolute positioning.
#[component]
fn GridAddRow(rows_signal: RwSignal<Vec<RowData>>, row_count_signal: Signal<usize>) -> impl IntoView {
    let rowindex = Signal::derive(move || row_count_signal.get() + 2);

    let handle_add_row = move |_| {
        rows_signal.update(|rows| {
            // Generate unique name for new row
            let new_row_num = rows.len() + 1;
            let new_name = format!("New Row {new_row_num}");
            rows.push(RowData { name: new_name, ..Default::default() });
        });
    };

    view! {
        <div
            role="row"
            aria-rowindex=move || rowindex.get().to_string()
            data-slot="grid-add-row"
            tabindex="-1"
            class="flex absolute w-full border-b transition-colors cursor-pointer bg-muted/30 hover:bg-muted/50"
            style=move || {
                let translate_y = row_count_signal.get() * 36;
                format!("height: 36px; transform: translateY({translate_y}px);")
            }
            on:click=handle_add_row
        >
            <div class="flex sticky left-0 gap-2 items-center px-3 text-muted-foreground">
                <Plus class="size-3.5" />
                <span class="text-sm">"Add row"</span>
            </div>
        </div>
    }
}

so model doesn't waste tokens
similarly tyhis as well
ui add demo_data_table
use std::collections::HashSet;

use icons::{ArrowUpDown, Ellipsis, Plus, Trash};
use leptos::portal::Portal;
use leptos::prelude::*;
use strum::{AsRefStr, Display, EnumString};

use crate::ui::alert_dialog::{
    AlertDialog, AlertDialogBody, AlertDialogClose, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
    AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
};
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::checkbox::Checkbox;
use crate::ui::data_table::{
    DataTable, DataTableBody, DataTableCell, DataTableHead, DataTableHeader, DataTableRow, DataTableWrapper,
};
use crate::ui::dropdown_menu::{
    DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
};
use crate::ui::input::Input;
use crate::ui::multi_select::{
    MultiSelect, MultiSelectContent, MultiSelectGroup, MultiSelectItem, MultiSelectOption, MultiSelectTrigger,
    MultiSelectValue,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
enum SortOrder {
    #[default]
    Asc,
    Desc,
}

const COLUMNS: [&str; 3] = ["Status", "Email", "Amount"];

#[component]
pub fn DemoDataTable() -> impl IntoView {
    let selected_emails_signal = RwSignal::new(HashSet::<&'static str>::new());
    let fake_payment_count_signal = RwSignal::new(0_usize);
    let columns_signal = RwSignal::new(HashSet::from(COLUMNS.map(|c| c.to_string())));
    let sort_order_signal = RwSignal::new(SortOrder::default());
    let email_filter_signal = RwSignal::new(String::new());
    let deleted_ids_signal = RwSignal::new(HashSet::<usize>::new());

    let sorted_payments_signal = Memo::new(move |_| {
        let filter = email_filter_signal.get().to_lowercase();
        let mut payments: Vec<Payment> = INITIAL_PAYMENTS.to_vec();

        let count = fake_payment_count_signal.get();
        for i in 0..count {
            payments.push(Payment::new(1000 + i));
        }

        // Filter out deleted payments
        payments.retain(|payment| {
            !deleted_ids_signal.with(|deleted| deleted.contains(&payment.id))
                && payment.email.to_lowercase().contains(&filter)
        });

        match sort_order_signal.get() {
            SortOrder::Asc => payments.sort_by(|a, b| a.email.cmp(b.email)),
            SortOrder::Desc => payments.sort_by(|a, b| b.email.cmp(a.email)),
        }
        payments
    });

    let selected_count_signal = Signal::derive(move || {
        sorted_payments_signal.with(|payments| {
            selected_emails_signal
                .with(|selected| payments.iter().filter(|payment| selected.contains(&payment.email)).count())
        })
    });

    let handle_select_all = Callback::new(move |checked: bool| {
        selected_emails_signal.update(|selected| {
            sorted_payments_signal.with(|payments| {
                for payment in payments {
                    if checked {
                        selected.insert(payment.email);
                    } else {
                        selected.remove(payment.email);
                    }
                }
            });
        });
    });

    view! {
        <div class="py-8 w-full">
            <div class="flex gap-4 items-center mb-4">
                <Input
                    class="max-w-sm"
                    attr:placeholder="Filter emails..."
                    prop:value=move || email_filter_signal.get()
                    on:input=move |ev| email_filter_signal.set(event_target_value(&ev))
                />
                <MultiSelect values=columns_signal>
                    <MultiSelectTrigger class="ml-auto w-[150px]">
                        <MultiSelectValue placeholder="Columns" />
                    </MultiSelectTrigger>
                    <MultiSelectContent>
                        <MultiSelectGroup>
                            {COLUMNS
                                .into_iter()
                                .map(|column| {
                                    let is_email = column == "Email";
                                    view! {
                                        <MultiSelectItem>
                                            <MultiSelectOption value=column attr:disabled=is_email>
                                                {column}
                                            </MultiSelectOption>
                                        </MultiSelectItem>
                                    }
                                })
                                .collect_view()}
                        </MultiSelectGroup>
                    </MultiSelectContent>
                </MultiSelect>
                <Button
                    size=ButtonSize::Icon
                    variant=ButtonVariant::Outline
                    on:click=move |_| {
                        fake_payment_count_signal.update(|count| *count += 1);
                    }
                >
                    <Plus class="text-muted-foreground" />
                </Button>
            </div>

            <DataTableWrapper>
                <DataTable>
                    <DataTableHeader>
                        <DataTableRow>
                            <DataTableHead class="px-4">
                                <Checkbox
                                    attr:aria-label="Select all"
                                    checked=Signal::derive(move || {
                                        sorted_payments_signal
                                            .with(|payments| {
                                                !payments.is_empty() && selected_count_signal.get() == payments.len()
                                            })
                                    })
                                    on_checked_change=handle_select_all
                                />
                            </DataTableHead>
                            {move || {
                                columns_signal
                                    .get()
                                    .contains("Status")
                                    .then(|| {
                                        view! { <DataTableHead class="px-4">Status</DataTableHead> }
                                    })
                            }}

                            {move || {
                                columns_signal
                                    .get()
                                    .contains("Email")
                                    .then(|| {
                                        view! {
                                            <DataTableHead class="px-4">
                                                <Button
                                                    variant=ButtonVariant::Ghost
                                                    on:click=move |_| {
                                                        sort_order_signal
                                                            .update(|order| {
                                                                *order = match *order {
                                                                    SortOrder::Asc => SortOrder::Desc,
                                                                    SortOrder::Desc => SortOrder::Asc,
                                                                };
                                                            });
                                                    }
                                                >
                                                    <span>Email</span>
                                                    <ArrowUpDown class="ml-2" />
                                                </Button>
                                            </DataTableHead>
                                        }
                                    })
                            }}

                            {move || {
                                columns_signal
                                    .get()
                                    .contains("Amount")
                                    .then(|| {
                                        view! { <DataTableHead class="px-4 text-right">Amount</DataTableHead> }
                                    })
                            }}

                            <DataTableHead class="px-4">""</DataTableHead>
                        </DataTableRow>
                    </DataTableHeader>
                    <DataTableBody>
                        <For each=move || sorted_payments_signal.get() key=|payment| payment.id let:payment>
                            {
                                let is_selected = Signal::derive(move || {
                                    selected_emails_signal.with(|selected| selected.contains(payment.email))
                                });
                                view! {
                                    <DataTableRow attr:data-state=move || {
                                        if is_selected.get() { "selected" } else { "" }
                                    }>
                                        <DataTableCell>
                                            <Checkbox
                                                checked=is_selected
                                                on_checked_change=Callback::new(move |checked| {
                                                    selected_emails_signal
                                                        .update(|selected| {
                                                            if checked {
                                                                selected.insert(payment.email);
                                                            } else {
                                                                selected.remove(payment.email);
                                                            }
                                                        });
                                                })
                                            />
                                        </DataTableCell>
                                        {move || {
                                            columns_signal
                                                .get()
                                                .contains("Status")
                                                .then(|| {
                                                    view! {
                                                        <DataTableCell>{payment.status.to_string()}</DataTableCell>
                                                    }
                                                })
                                        }}

                                        {move || {
                                            columns_signal
                                                .get()
                                                .contains("Email")
                                                .then(|| {
                                                    view! { <DataTableCell>{payment.email}</DataTableCell> }
                                                })
                                        }}

                                        {move || {
                                            columns_signal
                                                .get()
                                                .contains("Amount")
                                                .then(|| {
                                                    view! {
                                                        <DataTableCell class="font-medium text-right">
                                                            {format!("${:.2}", payment.amount)}
                                                        </DataTableCell>
                                                    }
                                                })
                                        }}

                                        <DataTableCell>
                                            <DropdownMenu>
                                                <DropdownMenuTrigger class="flex justify-center items-center p-0 w-8 h-8">
                                                    <span class="hidden">Open menu</span>
                                                    <Ellipsis class="size-4" />
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent class="w-[160px]">
                                                    <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                                    <DropdownMenuGroup class="mt-2">
                                                        <DropdownMenuItem class="p-0">
                                                            <AlertDialog class="w-full">
                                                                <AlertDialogTrigger class="w-full">
                                                                    <Trash class="text-destructive" />
                                                                    <span>Delete</span>
                                                                </AlertDialogTrigger>

                                                                <Portal>
                                                                    <AlertDialogContent class="w-[425px]">
                                                                        <AlertDialogBody>
                                                                            <AlertDialogHeader>
                                                                                <AlertDialogTitle>
                                                                                    "Are you absolutely sure?"
                                                                                </AlertDialogTitle>

                                                                                <AlertDialogDescription>
                                                                                    "This action cannot be undone. This will permanently delete the payment record for "
                                                                                    <strong>{payment.email}</strong> "."
                                                                                </AlertDialogDescription>
                                                                            </AlertDialogHeader>

                                                                            <AlertDialogFooter>
                                                                                <AlertDialogClose>"Cancel"</AlertDialogClose>
                                                                                <Button
                                                                                    variant=ButtonVariant::Destructive
                                                                                    on:click=move |_| {
                                                                                        deleted_ids_signal
                                                                                            .update(|deleted| {
                                                                                                deleted.insert(payment.id);
                                                                                            });
                                                                                        selected_emails_signal
                                                                                            .update(|selected| {
                                                                                                selected.remove(payment.email);
                                                                                            });
                                                                                    }
                                                                                >
                                                                                    "Delete"
                                                                                </Button>
                                                                            </AlertDialogFooter>
                                                                        </AlertDialogBody>
                                                                    </AlertDialogContent>
                                                                </Portal>
                                                            </AlertDialog>
                                                        </DropdownMenuItem>
                                                    </DropdownMenuGroup>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </DataTableCell>
                                    </DataTableRow>
                                }
                            }

                        </For>
                    </DataTableBody>
                </DataTable>
            </DataTableWrapper>

            <div class="flex justify-end items-center pt-4 space-x-2">
                <div class="flex-1 text-sm text-muted-foreground">
                    {move || {
                        format!(
                            "{} of {} row(s) selected.",
                            selected_count_signal.get(),
                            sorted_payments_signal.with(|p| p.len()),
                        )
                    }}

                </div>
                <div class="space-x-2">
                    <Button variant=ButtonVariant::Outline size=ButtonSize::Sm attr:disabled>
                        Previous
                    </Button>
                    <Button variant=ButtonVariant::Outline size=ButtonSize::Sm attr:disabled>
                        Next
                    </Button>
                </div>
            </div>
        </div>
    }
}

/* ========================================================== */
/*                     ✨ CONSTANTS ✨                        */
/* ========================================================== */

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Display, EnumString, AsRefStr)]
enum PaymentStatus {
    #[default]
    Processing,
    Failed,
    Success,
}

#[derive(Clone, PartialEq)]
struct Payment {
    id: usize,
    status: PaymentStatus,
    email: &'static str,
    amount: f64,
}

impl Payment {
    fn new(id: usize) -> Self {
        Self { id, status: PaymentStatus::default(), email: "newuser@example.com", amount: 500.00 }
    }
}

const INITIAL_PAYMENTS: &[Payment] = &[
    Payment { id: 1, status: PaymentStatus::Failed, email: "isabella.n@gmail.com", amount: 874.00 },
    Payment { id: 2, status: PaymentStatus::Success, email: "jackson.lee@email.com", amount: 837.00 },
    Payment { id: 3, status: PaymentStatus::Success, email: "ken99@yahoo.com", amount: 316.00 },
    Payment { id: 4, status: PaymentStatus::Processing, email: "olivia@example.com", amount: 242.00 },
    Payment { id: 5, status: PaymentStatus::Success, email: "william@company.com", amount: 721.00 },
];


even this aswell like if i ask dex to book a ticket to smthing it should display a date picker if  i didn't specify the date 
ui add demo_date_picker

if i secify the dtae it should show the picked date here 
ui add demo_date_picker
use icons::{ChevronLeft, ChevronRight};
use leptos::prelude::*;
use time::{Date, Month};

use crate::ui::date_picker::{
    DatePicker, DatePickerCell, DatePickerHeader, DatePickerNavButton, DatePickerRow, DatePickerTitle,
    DatePickerWeekDay,
};
use crate::ui::date_picker_state::{DatePickerDay, DatePickerState};
use crate::utils::query::QueryUtils;

#[component]
pub fn DemoDatePicker() -> impl IntoView {
    // Initialize dates from URL or use defaults
    let Some(default_start) = Date::from_calendar_date(2025, Month::May, 5).ok() else {
        return view! { <p>"Invalid default start date"</p> }.into_any();
    };
    let Some(default_end) = Date::from_calendar_date(2025, Month::May, 14).ok() else {
        return view! { <p>"Invalid default end date"</p> }.into_any();
    };

    let picker_state = DatePickerState::from_url_or_default(default_start, default_end);

    // Extract start and end dates as RwSignal
    let start_date_signal = RwSignal::new(picker_state.get_untracked().start_date);
    let end_date_signal = RwSignal::new(picker_state.get_untracked().end_date);

    // Track which month is currently displayed (independent from selected dates)
    let display_date_signal = RwSignal::new(picker_state.get_untracked().start_date);

    // Sync local signals with picker_state when URL changes
    Effect::new(move |_| {
        let state = picker_state.get();
        start_date_signal.set(state.start_date);
        end_date_signal.set(state.end_date);
        // Don't reset display_date_signal here - let user navigation control it
    });

    // Navigation: Go to previous month
    let go_to_previous_month = move |_| {
        let current = display_date_signal.get();
        let Some(new_date) = (if current.month() == Month::January {
            Date::from_calendar_date(current.year() - 1, Month::December, 1)
        } else {
            Date::from_calendar_date(current.year(), current.month().previous(), 1)
        })
        .ok() else {
            return;
        };
        display_date_signal.set(new_date);
    };

    // Navigation: Go to next month
    let go_to_next_month = move |_| {
        let current = display_date_signal.get();
        let Some(new_date) = (if current.month() == Month::December {
            Date::from_calendar_date(current.year() + 1, Month::January, 1)
        } else {
            Date::from_calendar_date(current.year(), current.month().next(), 1)
        })
        .ok() else {
            return;
        };
        display_date_signal.set(new_date);
    };

    // Handle day click
    let handle_day_click = move |day: u8| {
        if day == 0 {
            return;
        }

        let year = display_date_signal.get().year();
        let month = display_date_signal.get().month();
        let Some(new_date) = Date::from_calendar_date(year, month, day).ok() else { return };

        // Determine which date to update based on proximity (using full dates)
        let current_start = start_date_signal.get();
        let current_end = end_date_signal.get();

        let days_from_start = (new_date - current_start).whole_days().abs();
        let days_from_end = (new_date - current_end).whole_days().abs();

        if days_from_start <= days_from_end {
            start_date_signal.set(new_date);
        } else {
            end_date_signal.set(new_date);
        }

        // Ensure start_date_signal <= end_date_signal by swapping if needed
        if start_date_signal.get() > end_date_signal.get() {
            let temp = start_date_signal.get();
            start_date_signal.set(end_date_signal.get());
            end_date_signal.set(temp);
        }

        QueryUtils::update_dates_url(Some(start_date_signal.get()), Some(end_date_signal.get()));
    };

    view! {
        <DatePicker>
            <DatePickerHeader>
                <DatePickerNavButton
                    class="justify-self-start"
                    attr:title="previous-month"
                    attr:aria-label="Go to previous month"
                    on:click=go_to_previous_month
                >
                    <ChevronLeft />
                </DatePickerNavButton>
                <DatePickerTitle attr:role="presentation">
                    {move || display_date_signal.get().month().to_string()} {move || display_date_signal.get().year()}
                </DatePickerTitle>
                <DatePickerNavButton
                    class="justify-self-end"
                    attr:title="next-month"
                    attr:aria-label="Go to next month"
                    on:click=go_to_next_month
                >
                    <ChevronRight />
                </DatePickerNavButton>
            </DatePickerHeader>

            <table class="space-y-1 w-full border-collapse" role="grid">
                <thead>
                    <tr class="flex">
                        <DatePickerWeekDay attr:aria-label="Monday">Mo</DatePickerWeekDay>
                        <DatePickerWeekDay attr:aria-label="Tuesday">Tu</DatePickerWeekDay>
                        <DatePickerWeekDay attr:aria-label="Wednesday">We</DatePickerWeekDay>
                        <DatePickerWeekDay attr:aria-label="Thursday">Th</DatePickerWeekDay>
                        <DatePickerWeekDay attr:aria-label="Friday">Fr</DatePickerWeekDay>
                        <DatePickerWeekDay attr:aria-label="Saturday">Sa</DatePickerWeekDay>
                        <DatePickerWeekDay attr:aria-label="Sunday">Su</DatePickerWeekDay>
                    </tr>
                </thead>

                <tbody>
                    {move || {
                        let year = display_date_signal.get().year();
                        let month = display_date_signal.get().month();
                        let days = DatePickerState::get_calendar_days(year, month);
                        let weeks: Vec<Vec<DatePickerDay>> = days.chunks(7).map(|chunk| chunk.to_vec()).collect();

                        view! {
                            <For
                                each=move || weeks.clone()
                                key=|week| week.first().map(|d| d.day).unwrap_or(0)
                                children=move |week| {
                                    let year = year;
                                    let month = month;
                                    view! {
                                        <DatePickerRow>
                                            <For
                                                each=move || week.clone()
                                                key=|DatePickerDay { day, disabled }| format!("{day}-{disabled}")
                                                children=move |DatePickerDay { day, disabled }| {
                                                    view! {
                                                        <DatePickerCell
                                                            day=day
                                                            year=year
                                                            month=month
                                                            disabled=disabled
                                                            start_date=start_date_signal
                                                            end_date=end_date_signal
                                                            on_click=handle_day_click
                                                        />
                                                    }
                                                }
                                            />
                                        </DatePickerRow>
                                    }
                                }
                            />
                        }
                    }}
                </tbody>
            </table>
        </DatePicker>
    }
    .into_any()
}


asking for onfirmation

ui add demo_dialog

use leptos::prelude::*;

use crate::ui::button::Button;
use crate::ui::dialog::{
    Dialog, DialogBody, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
    DialogTrigger,
};
use crate::ui::input::Input;
use crate::ui::label::Label;

#[component]
pub fn DemoDialog() -> impl IntoView {
    let name_signal = RwSignal::new("Max Wells".to_string());
    let username_signal = RwSignal::new("@maxwells".to_string());

    view! {
        <Dialog>
            <DialogTrigger>Open Dialog</DialogTrigger>

            <DialogContent class="sm:max-w-[425px]">
                <DialogBody>
                    <DialogHeader>
                        <DialogTitle>"Edit profile"</DialogTitle>

                        <DialogDescription>
                            "Make changes to your profile here. Click save when you're done."
                        </DialogDescription>
                    </DialogHeader>

                    <div class="flex flex-col gap-4 justify-center">
                        <div class="flex flex-col gap-2">
                            <Label html_for="name-1">Name</Label>
                            <Input attr:autofocus=true attr:id="name-1" attr:name="name" prop:value=name_signal />
                        </div>
                        <div class="flex flex-col gap-2">
                            <Label html_for="username-1">Username</Label>
                            <Input attr:id="username-1" attr:name="username" prop:value=username_signal />
                        </div>
                    </div>

                    <DialogFooter>
                        <DialogClose class="w-full sm:w-fit">"Cancel"</DialogClose>
                        <Button attr:r#type="submit" class="w-full sm:w-fit">
                            Save changes
                        </Button>
                    </DialogFooter>
                </DialogBody>
            </DialogContent>
        </Dialog>
    }
}


even this for gen ui
ui add demo_drag_and_drop
like if i tell it to plan somthing and if it wants to ask me reorder i can simpley drag drop thestatemnts 
ui add demo_drag_and_drop
and put submit button kind of like priority

use leptos::prelude::*;

use crate::ui::drag_and_drop::{Draggable, DraggableItem, DraggableZone};

#[component]
pub fn DemoDragAndDrop() -> impl IntoView {
    view! {
        <Draggable class="max-w-2xl">
            <DraggableZone>
                <DraggableItem text="1" />
                <DraggableItem text="2" />
            </DraggableZone>
            <DraggableZone>
                <DraggableItem text="3" />
                <DraggableItem text="4" />
            </DraggableZone>
        </Draggable>
    }
}


ui add demo_dropdown_menu
this for also gen UI if needed and also for model selection in the prompt text input field

even this as well

ui add demo_dropzone
for gen ui and also file upload to input field


even this for gen ui
ui add demo_field
use leptos::prelude::*;

use crate::ui::button::{Button, ButtonVariant};
use crate::ui::checkbox::Checkbox;
use crate::ui::field::{
    Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSeparator, FieldSet, FieldVariant,
};
use crate::ui::input::Input;

#[component]
pub fn DemoField() -> impl IntoView {
    view! {
        <div class="w-full max-w-md">
            <FieldGroup>
                <FieldSet>
                    <FieldLegend>Payment Method</FieldLegend>
                    <FieldDescription>All transactions are secure and encrypted.</FieldDescription>
                    <FieldGroup>
                        <Field>
                            <FieldLabel html_for="card-name">Name on Card</FieldLabel>
                            <Input attr:id="card-name" placeholder="Evil Rabbit" />
                        </Field>
                        <Field>
                            <FieldLabel html_for="card-number">Card Number</FieldLabel>
                            <Input attr:id="card-number" placeholder="1234 5678 9012 3456" />
                            <FieldDescription>Enter your 16-digit card number.</FieldDescription>
                        </Field>
                        <div class="grid grid-cols-3 gap-4">
                            <Field>
                                <FieldLabel html_for="exp-month">Month</FieldLabel>
                                <Input attr:id="exp-month" placeholder="MM" />
                            </Field>
                            <Field>
                                <FieldLabel html_for="exp-year">Year</FieldLabel>
                                <Input attr:id="exp-year" placeholder="YYYY" />
                            </Field>
                            <Field>
                                <FieldLabel html_for="cvv">CVV</FieldLabel>
                                <Input attr:id="cvv" placeholder="123" />
                            </Field>
                        </div>
                    </FieldGroup>
                </FieldSet>
                <FieldSeparator />
                <FieldSet>
                    <FieldLegend>Billing Address</FieldLegend>
                    <FieldDescription>The billing address associated with your payment method.</FieldDescription>
                    <FieldGroup>
                        <Field variant=FieldVariant::Horizontal>
                            <Checkbox attr:id="same-as-shipping" checked=true />
                            <FieldLabel html_for="same-as-shipping" class="font-normal">
                                Same as shipping address
                            </FieldLabel>
                        </Field>
                    </FieldGroup>
                </FieldSet>
                <Field variant=FieldVariant::Horizontal>
                    <Button>"Submit"</Button>
                    <Button variant=ButtonVariant::Outline>"Cancel"</Button>
                </Field>
            </FieldGroup>
        </div>
    }
}


ui add demo_form
this as well for gen ui

use leptos::prelude::*;
use serde::{Deserialize, Serialize};
use validator::Validate;

use crate::hooks::use_form::use_form;
use crate::ui::form::{Form, FormDescription, FormField, FormGroup, FormInput, FormLabel, FormProvider, FormSet};

#[derive(Debug, Clone, Default, Serialize, Deserialize, Validate)]
struct FormData {
    username: String,
    password: String,
}

#[component]
pub fn DemoForm() -> impl IntoView {
    let form = use_form::<FormData>();

    view! {
        <FormProvider form=form>
            <Form class="max-w-md">
                <FormSet>
                    <FormGroup>
                        <FormField field="username">
                            <FormLabel>Username</FormLabel>
                            <FormInput attr:placeholder="Max Wells" />
                            <FormDescription>Choose a unique username for your account.</FormDescription>
                        </FormField>
                        <FormField field="password">
                            <FormLabel>Password</FormLabel>
                            <FormDescription>Must be at least 8 characters long.</FormDescription>
                            <FormInput attr:r#type="password" attr:placeholder="********" />
                        </FormField>
                    </FormGroup>
                </FormSet>
            </Form>
        </FormProvider>
    }
}


ui add demo_input_group for gen ui
use icons::{Check, CreditCard, Info, Mail, Search, Star};
use leptos::prelude::*;

use crate::ui::input_group::{InputGroup, InputGroupAddon, InputGroupAddonAlign, InputGroupInput};

#[component]
pub fn DemoInputGroup() -> impl IntoView {
    view! {
        <div class="grid gap-6 w-full max-w-sm">
            <InputGroup>
                <InputGroupInput placeholder="Search..." />
                <InputGroupAddon>
                    <Search />
                </InputGroupAddon>
            </InputGroup>

            <InputGroup>
                <InputGroupInput placeholder="Enter your email" />
                <InputGroupAddon>
                    <Mail />
                </InputGroupAddon>
            </InputGroup>

            <InputGroup>
                <InputGroupInput placeholder="Card number" />
                <InputGroupAddon>
                    <CreditCard />
                </InputGroupAddon>
                <InputGroupAddon align=InputGroupAddonAlign::InlineEnd>
                    <Check />
                </InputGroupAddon>
            </InputGroup>

            <InputGroup>
                <InputGroupInput placeholder="Card number" />
                <InputGroupAddon align=InputGroupAddonAlign::InlineEnd>
                    <Star />
                    <Info />
                </InputGroupAddon>
            </InputGroup>
        </div>
    }
}



----------------------

ui add demo_input_prompt this for the input feild where i can ask dex to do thing sand drag drop things 


------------------
ui add demo_item if applicable 

use icons::{BadgeCheck, ChevronRight};
use leptos::prelude::*;

use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::item::{Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemSize, ItemTitle, ItemVariant};

#[component]
pub fn DemoItem() -> impl IntoView {
    view! {
        <div class="flex flex-col gap-6 w-full max-w-md">
            <Item variant=ItemVariant::Outline>
                <ItemContent>
                    <ItemTitle>"Basic Item"</ItemTitle>
                    <ItemDescription>"A simple item with title and description."</ItemDescription>
                </ItemContent>
                <ItemActions>
                    <Button variant=ButtonVariant::Outline size=ButtonSize::Sm>
                        "Action"
                    </Button>
                </ItemActions>
            </Item>

            <Item variant=ItemVariant::Outline size=ItemSize::Sm href="#">
                <ItemMedia>
                    <BadgeCheck class="size-5" />
                </ItemMedia>
                <ItemContent>
                    <ItemTitle>"Your profile has been verified."</ItemTitle>
                </ItemContent>
                <ItemActions>
                    <ChevronRight class="size-4" />
                </ItemActions>
            </Item>
        </div>
    }
}

-----------------------------------------------------------------
ui add demo_kbd if applicable 

----------------------------------------------------------------

ui add demo_menubar even this if applicable and aso use this in GENERATIVE UI like above

-----------------------------------------------------------

ui add demo_multi_select for gen ui as well

----------------------------------------------------------
ui add demo_navigation_menu if applicable

-------------------------
ui add demo_pagination for gen ui as well

--------------------------
ui add demo_pressable maybe for notifications 
ui add demo_radio_button if applicable
ui add demo_progress for claude code integration usage
------------------------------------


ui add demo_scroll_area for gen ui as well
use leptos::prelude::*;

use crate::ui::scroll_area::ScrollArea;
use crate::ui::separator::Separator;

#[component]
pub fn DemoScrollArea() -> impl IntoView {
    let tags = (0..=50).rev().map(|i| format!("v1.2.0-beta.{}", i)).collect::<Vec<_>>();

    view! {
        <ScrollArea class="w-48 h-72 rounded-md border">
            <div class="p-4">
                <h4 class="mb-4 text-sm font-medium leading-none">Tags</h4>
                {tags
                    .into_iter()
                    .map(|tag| {
                        view! {
                            <>
                                <div class="text-sm">{tag}</div>
                                <Separator class="my-2" />
                            </>
                        }
                    })
                    .collect_view()}
            </div>
        </ScrollArea>
    }
}

---------------------------------------

ui add demo_slider

for gen ui as well
use leptos::prelude::*;

use crate::ui::slider::Slider;

#[component]
pub fn DemoSlider() -> impl IntoView {
    view! {
        <div class="flex flex-col gap-6">
            <Slider />
            <Slider attr:min="0" attr:max="100" attr:value="40" attr:step="5" />
            <Slider attr:disabled="true" attr:value="80" />
        </div>
    }
}

--------------------------------------------

ui add demo_sonner for notificatiuons 
------------------------------------

ui add demo_spinner if applicable

ui add demo_switch if applicable

------------------------
for side bar navigation https://rust-ui.com/blocks/sidenav#sidenav04




```rust
use icons::PanelLeft;
use leptos::prelude::*;
use leptos_router::StaticSegment;
use leptos_router::components::{Outlet, ParentRoute};
use leptos_router::hooks::use_location;

use crate::components::blocks::sidenav_routes::{DocsRoutes, SidenavRoutes};
use crate::components::blocks::sidenav_routes_selector::SidenavRoutesSelector;
use crate::components::blocks::sidenav_routes_simplified::SidenavRoutesSimplified;
use crate::components::demos::demo_dropdown_menu_user::DemoDropdownMenuUser;
use crate::components::ui::button::{ButtonSize, ButtonVariant};
use crate::components::ui::sheet::{Sheet, SheetContent, SheetContext, SheetDirection, SheetTrigger};
use crate::components::ui::sidenav::{
    Sidenav, SidenavContent, SidenavFooter, SidenavGroup, SidenavGroupContent, SidenavGroupLabel, SidenavHeader,
    SidenavLink, SidenavMenu, SidenavVariant, SidenavWrapper,
};

#[component(transparent)]
pub fn Sidenav04Routes() -> impl MatchNestedRoutes + Clone {
    view! {
        <ParentRoute path=StaticSegment(SidenavRoutes::view_segment()) view=|| view! { <Outlet /> }>
            <ParentRoute
                path=StaticSegment(SidenavRoutes::Sidenav04.as_ref())
                view=move || view! { <SidenavLayout sidenav_route=SidenavRoutes::Sidenav04 /> }
            >
                <SidenavRoutesSimplified />
            </ParentRoute>
        </ParentRoute>
    }
    .into_inner()
}

/* ========================================================== */
/*                     âœ¨ FUNCTIONS âœ¨                        */
/* ========================================================== */

// * ---> Layout with [ðŸ“ OUTLET] for nested routing (SidenavInset).
#[component]
pub fn SidenavLayout(sidenav_route: SidenavRoutes) -> impl IntoView {
    let location = use_location();

    // Determine current section from URL
    let current_section = Memo::new(move |_| {
        let path = location.pathname.get();
        if path.contains(DocsRoutes::Components.as_ref()) { DocsRoutes::Components } else { DocsRoutes::Hooks }
    });

    view! {
        <div class="bg-background">
            <SidenavWrapper attr:style="--sidenav-width:16rem;">
                // * Desktop Sidenav (hidden on mobile) - Floating variant
                <Sidenav variant=SidenavVariant::Floating>
                    <Sidenav04Content current_section sidenav_route />
                </Sidenav>

                // * ---> [ðŸ“ OUTLET] for nested routing (SidenavInset).
                // * Mobile Sheet is rendered in SidenavInsetRight header
                <Outlet />
            </SidenavWrapper>
        </div>
    }
}

/* ========================================================== */
/*                     âœ¨ SHARED CONTENT âœ¨                   */
/* ========================================================== */

/// Shared sidenav content used by both desktop Sidenav and mobile Sheet
#[component]
fn Sidenav04Content(current_section: Memo<DocsRoutes>, sidenav_route: SidenavRoutes) -> impl IntoView {
    // Try to get SheetContext - will be Some when inside a Sheet (mobile), None otherwise (desktop)
    let sheet_ctx = use_context::<SheetContext>();

    view! {
        <SidenavHeader>
            <SidenavRoutesSelector current_section sidenav_route />
        </SidenavHeader>

        <SidenavContent>
            {move || {
                let sheet_target_id = sheet_ctx.as_ref().map(|ctx| ctx.target_id.clone());
                let links = match current_section.get() {
                    DocsRoutes::Components => COMPONENT_LINKS,
                    DocsRoutes::Hooks => HOOKS_LINKS,
                };
                view! {
                    <SidenavGroup>
                        <SidenavGroupLabel>{move || current_section.get().to_title()}</SidenavGroupLabel>
                        <SidenavGroupContent>
                            <SidenavMenu>
                                {links
                                    .iter()
                                    .map(|(href, title)| {
                                        if let Some(ref target_id) = sheet_target_id {
                                            // Wrap in div with data-sheet-close when inside a Sheet (mobile)
                                            view! {
                                                <div data-sheet-close=target_id.clone()>
                                                    <SidenavLink href=*href>{*title}</SidenavLink>
                                                </div>
                                            }
                                                .into_any()
                                        } else {
                                            view! { <SidenavLink href=*href>{*title}</SidenavLink> }.into_any()
                                        }
                                    })
                                    .collect_view()}
                            </SidenavMenu>
                        </SidenavGroupContent>
                    </SidenavGroup>
                }
            }}
        </SidenavContent>

        <SidenavFooter>
            <DemoDropdownMenuUser />
        </SidenavFooter>
    }
}

/* ========================================================== */
/*                     âœ¨ MOBILE SHEET âœ¨                     */
/* ========================================================== */

/// Mobile sheet containing sidenav content - uses the proper Sheet component
#[component]
pub fn Sidenav04MobileSheet(current_section: Memo<DocsRoutes>, sidenav_route: SidenavRoutes) -> impl IntoView {
    view! {
        <Sheet>
            // * Trigger visible only on mobile, positioned in header flow
            <div class="md:hidden">
                <SheetTrigger class="size-7" variant=ButtonVariant::Ghost size=ButtonSize::Icon>
                    <PanelLeft class="size-4" />
                    <span class="hidden">"Toggle Sidenav"</span>
                </SheetTrigger>
            </div>

            <SheetContent
                direction=SheetDirection::Left
                class="p-0 w-[18rem] bg-sidenav text-sidenav-foreground"
                show_close_button=false
            >
                <div class="flex flex-col h-full">
                    <Sidenav04Content current_section sidenav_route />
                </div>
            </SheetContent>
        </Sheet>
    }
}

/* ========================================================== */
/*                     âœ¨ CONSTANTS âœ¨                        */
/* ========================================================== */

// * A simple example with basic links.

const COMPONENT_LINKS: &[(&str, &str)] = &[
    ("/view/sidenav04/docs/components/accordion", "Accordion"),
    ("/view/sidenav04/docs/components/alert", "Alert"),
    ("/view/sidenav04/docs/components/alert-dialog", "Alert Dialog"),
    ("/view/sidenav04/docs/components/button", "Button"),
    ("/view/sidenav04/docs/components/card", "Card"),
    ("/view/sidenav04/docs/components/checkbox", "Checkbox"),
    ("/view/sidenav04/docs/components/dialog", "Dialog"),
];

const HOOKS_LINKS: &[(&str, &str)] = &[
    ("/view/sidenav04/docs/hooks/use-copy-clipboard", "Use Copy Clipboard"),
    ("/view/sidenav04/docs/hooks/use-lock-body-scroll", "Use Lock Body Scroll"),
    ("/view/sidenav04/docs/hooks/use-random", "Use Random"),
];
```


and strictyly use RUST ICONS FROM HERE https://rust-ui.com/icons



FIRST CLONE EVERYTHING FROM https://github.com/rust-ui/ui.git to project directory and MAP ALL THESE UI
 i need eact UI ok? exact typograpohy exact icons and exact color scheme so i want u to clone it compulsory

DOnt do everything in one pass first write a clear plan and then DO it in recommended way choose priorities urself and do it

and also for GENERATIVE UI i want u to uuse every component that we USE IN OUR APP ok? hard code the UI COMPONENTS I WANT LESS MODEL TOKEN USAGE BUT WHIOLE BEING 100% ACCURATE and NO OVERFLOW OR DESIGN ISSUES

and its MIT LICENSED SO NOTHING WILL HAPPEN 

I NEED EXACT UI COMPONENTS

FOR EXTRA REFERENCE GPT SAID "Alert Dialog


use leptos::prelude::*;

use crate::ui::alert_dialog::{
    AlertDialog, AlertDialogBody, AlertDialogClose, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
    AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
};
use crate::ui::button::Button;

#[component]
pub fn DemoAlertDialog() -> impl IntoView {
    view! {
        <AlertDialog>
            <AlertDialogTrigger>Open Alert</AlertDialogTrigger>

            <AlertDialogContent class="w-[425px]">
                <AlertDialogBody>
                    <AlertDialogHeader>
                        <AlertDialogTitle>"Are you absolutely sure?"</AlertDialogTitle>

                        <AlertDialogDescription>
                            "This action cannot be undone. This will permanently delete your account and remove your data from our servers."
                        </AlertDialogDescription>
                    </AlertDialogHeader>

                    <AlertDialogFooter>
                        <AlertDialogClose class="w-full sm:w-fit">"Cancel"</AlertDialogClose>
                        <Button attr:r#type="submit" class="w-full sm:w-fit">
                            "Continue"
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogBody>
            </AlertDialogContent>
        </AlertDialog>
    }
}

------------------------------------------------------------

ui add demo_aspect_ratio

-------------------------------------------------------------

Attachment 

ui add demo_attachment
use icons::{FileCode, X};
use leptos::prelude::*;

use crate::ui::attachment::{
    Attachment, AttachmentAction, AttachmentActions, AttachmentContent, AttachmentDescription, AttachmentGroup,
    AttachmentMedia, AttachmentMediaVariant, AttachmentState, AttachmentTitle,
};
use crate::ui::spinner::Spinner;

#[component]
pub fn DemoAttachment() -> impl IntoView {
    view! {
        <div class="flex flex-col gap-3 py-12 mx-auto w-full max-w-sm">
            <AttachmentGroup>
                <Attachment orientation=crate::ui::attachment::AttachmentOrientation::Vertical>
                    <AttachmentMedia variant=AttachmentMediaVariant::Image>
                        <img
                            src="https://images.unsplash.com/photo-1497366754035-f200968a6e72?w=900&auto=format&fit=crop&q=80"
                            alt="Workspace"
                        />
                    </AttachmentMedia>
                    <AttachmentContent>
                        <AttachmentTitle>"workspace.png"</AttachmentTitle>
                        <AttachmentDescription>"PNG · 820 KB"</AttachmentDescription>
                    </AttachmentContent>
                </Attachment>
                <Attachment orientation=crate::ui::attachment::AttachmentOrientation::Vertical>
                    <AttachmentMedia variant=AttachmentMediaVariant::Image>
                        <img
                            src="https://images.unsplash.com/photo-1497215728101-856f4ea42174?w=900&auto=format&fit=crop&q=80"
                            alt="Desk"
                        />
                    </AttachmentMedia>
                    <AttachmentContent>
                        <AttachmentTitle>"desk-reference.jpg"</AttachmentTitle>
                        <AttachmentDescription>"JPG · 1.1 MB"</AttachmentDescription>
                    </AttachmentContent>
                </Attachment>
                <Attachment orientation=crate::ui::attachment::AttachmentOrientation::Vertical>
                    <AttachmentMedia variant=AttachmentMediaVariant::Image>
                        <img
                            src="https://images.unsplash.com/photo-1497366811353-6870744d04b2?w=900&auto=format&fit=crop&q=80"
                            alt="Office"
                        />
                    </AttachmentMedia>
                    <AttachmentContent>
                        <AttachmentTitle>"office-reference.jpg"</AttachmentTitle>
                        <AttachmentDescription>"JPG · 940 KB"</AttachmentDescription>
                    </AttachmentContent>
                </Attachment>
            </AttachmentGroup>
            <Attachment state=AttachmentState::Uploading class="w-full">
                <AttachmentMedia>
                    <Spinner />
                </AttachmentMedia>
                <AttachmentContent>
                    <AttachmentTitle>"sales-dashboard.pdf"</AttachmentTitle>
                    <AttachmentDescription>"Uploading · 64%"</AttachmentDescription>
                </AttachmentContent>
                <AttachmentActions>
                    <AttachmentAction attr:aria-label="Cancel upload">
                        <X />
                    </AttachmentAction>
                </AttachmentActions>
            </Attachment>
            <Attachment class="w-full">
                <AttachmentMedia>
                    <FileCode />
                </AttachmentMedia>
                <AttachmentContent>
                    <AttachmentTitle>"message-renderer.tsx"</AttachmentTitle>
                    <AttachmentDescription>"TypeScript · 12 KB"</AttachmentDescription>
                </AttachmentContent>
                <AttachmentActions>
                    <AttachmentAction attr:aria-label="Remove message-renderer.tsx">
                        <X />
                    </AttachmentAction>
                </AttachmentActions>
            </Attachment>
        </div>
    }
}

--------------------------------------------------------

ui add demo_auto_form

--------------------------------------------------------

ui add demo_badge

--------------------------------------------------------
ui add demo_breadcrumb
-------------------------------------------------------

ui add demo_bubble
use leptos::prelude::*;

use crate::ui::bubble::{Bubble, BubbleContent, BubbleGroup, BubbleReactions, BubbleVariant};

#[component]
pub fn DemoBubble() -> impl IntoView {
    view! {
        <div class="flex flex-col gap-8 py-12 w-full max-w-sm">
            <Bubble align=crate::ui::bubble::BubbleAlign::End>
                <BubbleContent>"Hey there! what's up?"</BubbleContent>
            </Bubble>
            <BubbleGroup>
                <Bubble variant=BubbleVariant::Muted>
                    <BubbleContent>"Hey! Want to see chat bubbles?"</BubbleContent>
                </Bubble>
                <Bubble variant=BubbleVariant::Muted>
                    <BubbleContent>
                        "I can group messages, switch sides, and keep the whole thread easy to scan."
                    </BubbleContent>
                    <BubbleReactions attr:role="img" attr:aria-label="Reaction: thumbs up">
                        <span>"👍"</span>
                    </BubbleReactions>
                </Bubble>
            </BubbleGroup>
            <Bubble align=crate::ui::bubble::BubbleAlign::End>
                <BubbleContent>"Sure. Hit me with your best demo."</BubbleContent>
            </Bubble>
            <Bubble variant=BubbleVariant::Muted>
                <BubbleContent>
                    "Yes. You are reading a demo that is demoing itself. Very meta. Very on-brand."
                </BubbleContent>
                <BubbleReactions attr:role="img" attr:aria-label="Reactions: thumbs up, fire, eyes, and 2 more">
                    <span>"👍"</span>
                    <span>"🔥"</span>
                    <span>"👀"</span>
                    <span>"+2"</span>
                </BubbleReactions>
            </Bubble>
        </div>
    }
}


implement this for chats even this ui add demo_message
use leptos::prelude::*;

use crate::ui::avatar::{Avatar, AvatarFallback, AvatarImage};
use crate::ui::bubble::{Bubble, BubbleContent, BubbleGroup, BubbleReactions, BubbleVariant};
use crate::ui::marker::{Marker, MarkerContent};
use crate::ui::message::{Message, MessageAlign, MessageAvatar, MessageContent, MessageFooter};

#[component]
pub fn DemoMessage() -> impl IntoView {
    view! {
        <div class="flex flex-col gap-6 py-12 w-full max-w-sm">
            <Message align=MessageAlign::End>
                <MessageAvatar>
                    <Avatar>
                        <AvatarImage attr:src="/avatars/10.png" attr:alt="@me" />
                        <AvatarFallback>"ME"</AvatarFallback>
                    </Avatar>
                </MessageAvatar>
                <MessageContent>
                    <Bubble>
                        <BubbleContent>"Deploying to prod real quick."</BubbleContent>
                    </Bubble>
                </MessageContent>
            </Message>
            <Message>
                <MessageAvatar>
                    <Avatar>
                        <AvatarImage attr:src="/avatars/02.png" attr:alt="@rabbit" />
                        <AvatarFallback>"R"</AvatarFallback>
                    </Avatar>
                </MessageAvatar>
                <MessageContent>
                    <Bubble variant=BubbleVariant::Muted>
                        <BubbleContent>"It's 4:55 PM. On a Friday."</BubbleContent>
                    </Bubble>
                </MessageContent>
            </Message>
            <Message align=MessageAlign::End>
                <MessageAvatar>
                    <Avatar>
                        <AvatarImage attr:src="/avatars/10.png" attr:alt="@me" />
                        <AvatarFallback>"ME"</AvatarFallback>
                    </Avatar>
                </MessageAvatar>
                <MessageContent>
                    <Bubble>
                        <BubbleContent>"It's a one-line change."</BubbleContent>
                    </Bubble>
                    <MessageFooter>"Delivered"</MessageFooter>
                </MessageContent>
            </Message>
            <Message>
                <MessageAvatar>
                    <Avatar>
                        <AvatarImage attr:src="/avatars/02.png" attr:alt="@rabbit" />
                        <AvatarFallback>"R"</AvatarFallback>
                    </Avatar>
                </MessageAvatar>
                <MessageContent>
                    <BubbleGroup>
                        <Bubble variant=BubbleVariant::Muted>
                            <BubbleContent>"It's always a one-line change 😭."</BubbleContent>
                        </Bubble>
                        <Bubble variant=BubbleVariant::Muted>
                            <BubbleContent>"Alright, let me take a look."</BubbleContent>
                            <BubbleReactions attr:aria-label="Reactions: thumbs up">
                                <span>"👍"</span>
                            </BubbleReactions>
                        </Bubble>
                    </BubbleGroup>
                </MessageContent>
            </Message>
            <Marker role="status">
                <MarkerContent class="shimmer">
                    <span class="font-medium">"Oliver"</span>
                    " is typing..."
                </MarkerContent>
            </Marker>
        </div>
    }
}

-----------------------------------------------------------

ui add demo_button
-----------------------------------------------------------
ui add demo_button_action this button for full access and important things
use icons::Trash2;
use leptos::prelude::*;

use crate::ui::button_action::ButtonAction;
use crate::ui::toast_custom::toast_wrapper::show_toast;

#[component]
pub fn DemoButtonAction() -> impl IntoView {
    let on_complete = Callback::new(move |_| {
        show_toast().success("Action completed!");
    });

    view! {
        <ButtonAction on_complete=on_complete duration_ms=2000>
            <Trash2 />
            <span>"Hold to Delete"</span>
        </ButtonAction>
    }
}

------------------------------------------------------------

ui add demo_button_group

use leptos::prelude::*;

use crate::ui::button::{Button, ButtonVariant};
use crate::ui::button_group::ButtonGroup;

#[component]
pub fn DemoButtonGroup() -> impl IntoView {
    view! {
        <ButtonGroup>
            <Button variant=ButtonVariant::Outline>"First"</Button>
            <Button variant=ButtonVariant::Outline>"Second"</Button>
            <Button variant=ButtonVariant::Outline>"Third"</Button>
        </ButtonGroup>
    }
}

if applicable
-------------------------------------------------------------

ui add demo_card_carousel

use icons::{ChevronLeft, ChevronRight};
use leptos::prelude::*;

use crate::ui::card::{CardContent, CardDescription, CardTitle};
use crate::ui::card_carousel::{
    CardCarousel, CardCarouselImage, CardCarouselIndicator, CardCarouselIndicators, CardCarouselNav,
    CardCarouselNavButton, CardCarouselOverlay, CardCarouselSlide, CardCarouselTrack,
};

/* ========================================================== */
/*                     ✨ FUNCTIONS ✨                        */
/* ========================================================== */

#[component]
pub fn DemoCardCarousel() -> impl IntoView {
    let images_count = IMAGES.len();

    view! {
        <div class="my-4">
            <CardCarousel>
                <CardCarouselOverlay>
                    <CardCarouselNav>
                        <CardCarouselNavButton attr:aria-disabled=true>
                            <ChevronLeft />
                        </CardCarouselNavButton>
                        <CardCarouselNavButton>
                            <ChevronRight />
                        </CardCarouselNavButton>
                    </CardCarouselNav>
                    <CardCarouselIndicators>
                        {(0..images_count)
                            .map(|i| {
                                view! { <CardCarouselIndicator attr:aria-current=move || i == 0 /> }
                            })
                            .collect_view()}
                    </CardCarouselIndicators>
                </CardCarouselOverlay>
                <CardCarouselTrack>
                    {IMAGES
                        .iter()
                        .map(|src| {
                            view! {
                                <CardCarouselSlide>
                                    <CardCarouselImage attr:src=*src attr:alt="CardCarousel img" />
                                </CardCarouselSlide>
                            }
                        })
                        .collect_view()}
                </CardCarouselTrack>
            </CardCarousel>

            <CardContent class="py-4">
                <CardTitle>"MV, Maldives"</CardTitle>
                <CardDescription>"4,843 kilometers away"</CardDescription>
                <CardDescription>"Aug 1 – 6"</CardDescription>
                <CardDescription>"$685 per night"</CardDescription>
            </CardContent>
        </div>
    }
}

/* ========================================================== */
/*                     ✨ CONSTANTS ✨                        */
/* ========================================================== */

const IMAGES: &[&str] = &[
    "https://a0.muscache.com/im/pictures/e24c13b9-dd2a-4e15-9845-dd588a884e39.jpg?im_w=720",
    "https://a0.muscache.com/im/pictures/373443ec-b377-4181-b753-3a2f3508c2b3.jpg?im_w=720",
    "https://a0.muscache.com/im/pictures/97b92645-f975-4e60-9ae0-205885af64b0.jpg?im_w=720",
    "https://a0.muscache.com/im/pictures/0089340a-409a-4fbe-9ab7-cb26884bf267.jpg?im_w=720",
    "https://a0.muscache.com/im/pictures/90e58fdf-257b-43a5-a6dc-a08f518397fe.jpg?im_w=720",
];


add this for displaying the artifacts when there are multiple ok? (by relevance)

-------------------------------------------

ui add demo_checkbox

use leptos::prelude::*;

use crate::ui::checkbox::Checkbox;
use crate::ui::label::Label;

#[component]
pub fn DemoCheckbox() -> impl IntoView {
    let item1_signal = RwSignal::new(true);
    let item2_signal = RwSignal::new(false);

    view! {
        <div class="flex flex-col gap-4">
            <div class="flex gap-2 items-center">
                <Checkbox
                    attr:id="item1"
                    checked=item1_signal
                    on_checked_change=Callback::new(move |checked| {
                        item1_signal.set(checked);
                    })
                />
                <Label html_for="item1">Item 1</Label>
            </div>
            <div class="flex gap-2 items-center">
                <Checkbox
                    attr:id="item2"
                    checked=item2_signal
                    on_checked_change=Callback::new(move |checked| {
                        item2_signal.set(checked);
                    })
                />
                <Label html_for="item2">Item 2</Label>
            </div>
            <div class="flex gap-2 items-center">
                <Checkbox attr:id="disabled1" checked=true disabled=true />
                <Label html_for="disabled1">Disabled</Label>
            </div>
            <div class="flex gap-2 items-center">
                <Checkbox attr:id="disabled2" disabled=true />
                <Label html_for="disabled2">Disabled</Label>
            </div>
        </div>
    }
}


this for task planning and completion and stuff even use this iff needed 
ui add demo_marker
use icons::{GitBranch, Search};
use leptos::prelude::*;

use crate::ui::marker::{Marker, MarkerContent, MarkerIcon, MarkerVariant};
use crate::ui::spinner::Spinner;

#[component]
pub fn DemoMarker() -> impl IntoView {
    view! {
        <div class="flex flex-col gap-8 py-12 w-full max-w-sm">
            <Marker>
                <MarkerIcon>
                    <GitBranch />
                </MarkerIcon>
                <MarkerContent>"Switched to a new branch"</MarkerContent>
            </Marker>
            <Marker role="status">
                <MarkerIcon>
                    <Spinner />
                </MarkerIcon>
                <MarkerContent class="shimmer">"Thinking..."</MarkerContent>
            </Marker>
            <Marker variant=MarkerVariant::Separator>
                <MarkerContent>"Conversation compacted"</MarkerContent>
            </Marker>
            <Marker>
                <MarkerIcon>
                    <Search />
                </MarkerIcon>
                <MarkerContent>"Explored 4 files"</MarkerContent>
            </Marker>
        </div>
    }
}

also this also for planning ui add demo_stepper
use leptos::prelude::*;

use crate::ui::stepper::{
    Stepper, StepperDescription, StepperIndicator, StepperItem, StepperSeparator, StepperTitle, StepperTrigger,
};

#[component]
pub fn DemoStepper() -> impl IntoView {
    view! {
        <Stepper total_steps=3 default_step=1 class="w-full max-w-md">
            <StepperItem step=0>
                <StepperTrigger>
                    <StepperIndicator />
                    <div class="flex flex-col gap-0.5 items-center text-center">
                        <StepperTitle>"Account"</StepperTitle>
                        <StepperDescription>"Create your account"</StepperDescription>
                    </div>
                </StepperTrigger>
                <StepperSeparator />
            </StepperItem>
            <StepperItem step=1>
                <StepperTrigger>
                    <StepperIndicator />
                    <div class="flex flex-col gap-0.5 items-center text-center">
                        <StepperTitle>"Profile"</StepperTitle>
                        <StepperDescription>"Complete your profile"</StepperDescription>
                    </div>
                </StepperTrigger>
                <StepperSeparator />
            </StepperItem>
            <StepperItem step=2>
                <StepperTrigger>
                    <StepperIndicator />
                    <div class="flex flex-col gap-0.5 items-center text-center">
                        <StepperTitle>"Confirmation"</StepperTitle>
                        <StepperDescription>"Review and confirm"</StepperDescription>
                    </div>
                </StepperTrigger>
            </StepperItem>
        </Stepper>
    }
}


in a neat structured way ok? idk what u will do i need feature and UI UX RICH PLANNING UI UX



----------------------------------------------------------

ui add demo_chips 

use leptos::prelude::*;

use crate::ui::chips::{ChipItem, ChipsContainer};

#[component]
pub fn DemoChips() -> impl IntoView {
    view! {
        <ChipsContainer>
            <ChipItem label="sunny" />
            <ChipItem label="cloudy" />
            <ChipItem label="rainy" />
            <ChipItem label="windy" />
            <ChipItem label="stormy" />
            <ChipItem label="foggy" />
            <ChipItem label="snowy" />
            <ChipItem label="icy" />
            <ChipItem label="humid" />
            <ChipItem label="dry" />
            <ChipItem label="hot" />
            <ChipItem label="cold" />
            <ChipItem label="warm" />
            <ChipItem label="chilly" />
            <ChipItem label="breezy" />
            <ChipItem label="gusty" />
            <ChipItem label="hazy" />
        </ChipsContainer>
    }
}


for like slash commands like when type /plan anywhere it should insert this ship ininpuit feild 
------------------------------------------------------------

ui add demo_collapsible if applicable
-------------------------------------

ui add demo_combobox

use icons::{ChevronsUpDown, Search};
use leptos::prelude::*;
use strum::{Display, EnumIter, IntoEnumIterator};

use crate::ui::command::{Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList};
use crate::ui::popover::{Popover, PopoverAlign, PopoverContent, PopoverTrigger};

/* ========================================================== */
/*                     ✨ FUNCTIONS ✨                        */
/* ========================================================== */

#[derive(Debug, Clone, Copy, PartialEq, Eq, Display, EnumIter)]
enum Language {
    Rust,
    JavaScript,
    Ruby,
    Python,
}

#[component]
pub fn DemoCombobox() -> impl IntoView {
    let value_signal = RwSignal::new(None::<Language>);

    view! {
        <Popover align=PopoverAlign::Start>
            <PopoverTrigger class="justify-between w-[200px]">
                <span class="truncate">
                    {move || value_signal.get().map(|l| l.to_string()).unwrap_or_else(|| "Select language...".into())}
                </span>
                <ChevronsUpDown class="ml-auto opacity-50 size-4" />
            </PopoverTrigger>

            <PopoverContent class="p-0 w-[200px]">
                <Command>
                    <div class="flex gap-2 items-center px-2 border-b">
                        <Search class="size-4 text-muted-foreground shrink-0" />
                        <CommandInput attr:placeholder="Search language..." />
                    </div>
                    <CommandList class="min-h-0">
                        <CommandEmpty>"No language found."</CommandEmpty>
                        <CommandGroup>
                            {Language::iter()
                                .map(|language| {
                                    let label = language.to_string();
                                    let is_selected = Signal::derive(move || value_signal.get() == Some(language));
                                    view! {
                                        <CommandItem
                                            value=label.clone()
                                            selected=is_selected
                                            on_select=Callback::new(move |_| {
                                                value_signal.set(Some(language));
                                            })
                                        >
                                            {label}
                                        </CommandItem>
                                    }
                                })
                                .collect_view()}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    }
}

if applicable 
---------------------
ui add demo_command if applicable
-----------------------

ui add demo_data_grid when it wants to generate structured table or smthing like that kind of like Generative UI
ui add demo_data_grid but hardcoded 
use std::collections::HashSet;
use std::sync::LazyLock;

use icons::{Copy, Eraser, Plus, Scissors, Settings2, Trash2};
use leptos::prelude::*;
use serde::{Deserialize, Serialize};
use strum::{AsRefStr, Display, EnumIter, IntoEnumIterator};

use crate::hooks::use_cell_edit::use_cell_edit;
use crate::hooks::use_column_state::{ColumnState, use_column_state};
use crate::hooks::use_copy_clipboard::use_copy_clipboard;
use crate::hooks::use_data_grid_state::{DataGridState, use_data_grid_state};
use crate::hooks::use_press_hold::use_press_hold;
use crate::ui::badge::{Badge, BadgeVariant};
use crate::ui::checkbox::Checkbox;
use crate::ui::context_menu::{
    ContextMenu, ContextMenuAction, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuTrigger,
};
use crate::ui::data_grid::{
    DataGridColumn, DataGridToolbar, EditableCellContent, Grid, GridBody, GridCell, GridCellWrapper, GridHeaderCell,
    GridPinnedCell, GridPinnedHeaderCell, GridRow, GridSelectCell, GridSelectHeaderCell, GridWrapper, PinnableColumn,
    PinnableSortableHeaderCell, SortDirection, SortableColumn, generate_grid_style, get_column_width,
    get_pinned_left_position, get_pinned_visible_columns,
};
use crate::ui::multi_select::{
    MultiSelect, MultiSelectAlign, MultiSelectContent, MultiSelectGroup, MultiSelectItem, MultiSelectOption,
    MultiSelectTrigger,
};
use crate::ui::separator::Separator;
use crate::ui::toast_custom::toaster::expect_toaster;

/* ========================================================== */
/*                     ✨ TYPES ✨                            */
/* ========================================================== */

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Display, AsRefStr, EnumIter)]
#[strum(serialize_all = "title_case")]
pub enum Column {
    Select,
    Name,
    Age,
    Email,
    Website,
    Notes,
    Salary,
    Department,
    Status,
    Skills,
    IsActive,
    StartDate,
    Attachments,
}

impl DataGridColumn for Column {
    fn colindex(self) -> i32 {
        self as i32 + 1
    }

    fn is_disabled(self) -> bool {
        matches!(self, Self::Select | Self::Name | Self::Email)
    }
}

impl SortableColumn<RowData> for Column {
    fn compare(self, a: &RowData, b: &RowData) -> Option<std::cmp::Ordering> {
        match self {
            Self::Name => Some(a.name.cmp(&b.name)),
            Self::Age => Some(a.age.cmp(&b.age)),
            Self::Email => Some(a.email.cmp(&b.email)),
            Self::Website => Some(a.website.cmp(&b.website)),
            Self::Notes => Some(a.notes.cmp(&b.notes)),
            Self::Salary => Some(a.salary.cmp(&b.salary)),
            Self::Department => Some(a.department.cmp(&b.department)),
            Self::Status => Some(a.status.cmp(&b.status)),
            Self::Skills => Some(a.skills.len().cmp(&b.skills.len())),
            Self::IsActive => Some(a.is_active.cmp(&b.is_active)),
            Self::StartDate => Some(a.start_date.cmp(&b.start_date)),
            Self::Select | Self::Attachments => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct RowData {
    pub name: String,
    pub age: i32,
    pub email: String,
    pub website: String,
    pub notes: String,
    pub salary: i32,
    pub department: String,
    pub status: String,
    pub skills: Vec<String>,
    pub is_active: bool,
    pub start_date: String,
}

/// Pinnable columns with their widths in order they should appear when pinned
const PINNABLE_COLUMNS: &[(Column, i32)] = &[
    (Column::Name, 180),
    (Column::Age, 150),
    (Column::Email, 240),
    (Column::Website, 240),
    (Column::Notes, 200),
    (Column::Salary, 180),
    (Column::Department, 180),
    (Column::Status, 180),
    (Column::Skills, 240),
    (Column::IsActive, 110),
    (Column::StartDate, 150),
    (Column::Attachments, 240),
];

impl PinnableColumn for Column {
    fn pinnable_columns() -> &'static [(Self, i32)] {
        PINNABLE_COLUMNS
    }
}

impl Column {
    fn wrapper_class(self) -> &'static str {
        match self {
            Self::IsActive => "flex justify-center",
            _ => "",
        }
    }

    fn get_value(self, row: &RowData) -> String {
        match self {
            Self::Name => row.name.clone(),
            Self::Age => row.age.to_string(),
            Self::Email => row.email.clone(),
            Self::Website => row.website.clone(),
            Self::Notes => row.notes.clone(),
            Self::Salary => row.salary.to_string(),
            Self::Department => row.department.clone(),
            Self::Status => row.status.clone(),
            Self::Skills => row.skills.join(", "),
            Self::IsActive => row.is_active.to_string(),
            Self::StartDate => row.start_date.clone(),
            Self::Select | Self::Attachments => String::new(),
        }
    }
}

/// CSS custom properties for column sizes, generated from PINNABLE_COLUMNS.
static GRID_STYLE: LazyLock<String> = LazyLock::new(generate_grid_style::<Column>);

/* ========================================================== */
/*                     ✨ SERVER FUNCTION ✨                  */
/* ========================================================== */

#[server]
pub async fn get_data_grid_rows() -> Result<Vec<RowData>, ServerFnError> {
    // Simulate server-side data fetching
    let rows = vec![
        RowData {
            name: "Toby Deckow".to_string(),
            age: 50,
            email: "toby.deckow32@yahoo.com".to_string(),
            website: "https://young-plain.net".to_string(),
            notes: "Relocated from the Seattle office last month. Adjusting well to the new team dynamics and company culture.".to_string(),
            salary: 42953,
            department: "Finance".to_string(),
            status: "In Office".to_string(),
            skills: vec!["Docker".to_string(), "JavaScript".to_string(), "SQL".to_string()],
            is_active: true,
            start_date: "12/13/2020".to_string(),
        },
        RowData {
            name: "Montserrat Kutch".to_string(),
            age: 52,
            email: "montserrat_kutch@yahoo.com".to_string(),
            website: "https://major-footrest.net".to_string(),
            notes: "Transferred from the marketing department. Bringing valuable cross-functional experience to the team.".to_string(),
            salary: 64820,
            department: "Marketing".to_string(),
            status: "In Office".to_string(),
            skills: vec!["AWS".to_string(), "Git".to_string(), "SQL".to_string(), "React".to_string()],
            is_active: true,
            start_date: "6/28/2023".to_string(),
        },
        RowData {
            name: "Alice Chen".to_string(),
            age: 34,
            email: "alice.chen@gmail.com".to_string(),
            website: "https://devblog-alice.io".to_string(),
            notes: "Senior developer with expertise in distributed systems. Leading the backend migration project.".to_string(),
            salary: 95000,
            department: "Engineering".to_string(),
            status: "Remote".to_string(),
            skills: vec!["Rust".to_string(), "Kubernetes".to_string(), "PostgreSQL".to_string(), "Go".to_string()],
            is_active: true,
            start_date: "3/15/2019".to_string(),
        },
        RowData {
            name: "James Rodriguez".to_string(),
            age: 28,
            email: "j.rodriguez@company.com".to_string(),
            website: "https://jamesux.design".to_string(),
            notes: "UI/UX designer focused on accessibility and user research. Recently completed design system overhaul.".to_string(),
            salary: 72500,
            department: "Design".to_string(),
            status: "Hybrid".to_string(),
            skills: vec!["Figma".to_string(), "CSS".to_string(), "TypeScript".to_string()],
            is_active: false,
            start_date: "9/01/2022".to_string(),
        },
    ];

    Ok(rows)
}

#[component]
pub fn DemoDataGrid() -> impl IntoView {
    view! { <DataGridFull /> }
}

/* ========================================================== */
/*                     ✨ FUNCTIONS ✨                        */
/* ========================================================== */

#[component]
pub fn DataGridFull() -> impl IntoView {
    let rows_resource = Resource::new(|| (), |_| async move { get_data_grid_rows().await });
    let rows_signal = RwSignal::new(Vec::<RowData>::new());

    let selected_indices_signal = RwSignal::new(HashSet::<usize>::new());

    let ColumnState { sort_signals, pinned_columns_signal, visible_columns_signal } =
        use_column_state(PINNABLE_COLUMNS);

    // Grid state (cell selection, drag selection, click outside)
    let DataGridState { cell_selection, drag_selection, copy_value_signal, grid_wrapper_ref } =
        use_data_grid_state::<Column>();

    // Copy to clipboard
    let (copy_to_clipboard, _) = use_copy_clipboard(None);
    let copy_to_clipboard = StoredValue::new(copy_to_clipboard);

    // Cell edit hook (double-click to edit)
    let _cell_edit = use_cell_edit::<Column>();

    // Create sorted rows memo
    let sorted_rows_signal = Memo::new(move |_| {
        let mut rows: Vec<RowData> = rows_signal.get();

        // Apply sorting in order (last one with a value takes precedence)
        sort_signals.with_value(|signals| {
            for (col, _) in PINNABLE_COLUMNS {
                if let Some(signal) = signals.get(col) {
                    col.sort_rows(&mut rows, signal.get());
                }
            }
        });

        rows
    });

    let row_count_signal = Signal::derive(move || rows_signal.with(|rows| rows.len()));

    // Dynamic height for virtual scrolling: (row_count + 1) * 36px to include add row button
    let grid_body_height = Signal::derive(move || {
        let row_count = row_count_signal.get();
        format!("height: {}px", (row_count + 1) * 36)
    });

    let selected_count_signal = Signal::derive(move || selected_indices_signal.with(|selected| selected.len()));

    let handle_select_all = Callback::new(move |checked: bool| {
        let row_count = row_count_signal.get();
        selected_indices_signal.update(|selected| {
            if checked {
                for index in 0..row_count {
                    selected.insert(index);
                }
            } else {
                selected.clear();
            }
        });
    });

    // Delete rows handler (swap this for server action when using real DB)
    let handle_delete_rows = Callback::new(move |names: Vec<String>| {
        rows_signal.update(|rows| {
            rows.retain(|r| !names.contains(&r.name));
        });
    });

    view! {
        <div class="container flex flex-col py-4">
            <ToolbarDataGrid visible_columns_signal />

            <Transition fallback=move || {
                view! { <p class="text-gray-500">"Loading data..."</p> }
            }>
                {move || {
                    rows_resource
                        .get()
                        .map(|result| {
                            match result {
                                Ok(rows) => {
                                    rows_signal.set(rows);
                                    view! {
                                        <div
                                            node_ref=grid_wrapper_ref
                                            on:mouseup=move |_| drag_selection.stop_dragging()
                                            on:mouseleave=move |_| drag_selection.stop_dragging()
                                        >
                                            <GridWrapper>
                                                <button
                                                    type="button"
                                                    id="radix-_R_mlubsqlb_"
                                                    aria-haspopup="menu"
                                                    aria-expanded="false"
                                                    data-state="closed"
                                                    data-slot="dropdown-menu-trigger"
                                                    style="position:fixed;left:0px;top:0px;width:1px;height:1px;padding:0;margin:0;border:none;background:transparent;pointer-events:none;opacity:0"
                                                ></button>
                                                <Grid
                                                    rowcount=Signal::derive(move || {
                                                        i32::try_from(row_count_signal.get()).unwrap_or(0) + 1
                                                    })
                                                    colcount=i32::try_from(Column::iter().count()).unwrap_or(0)
                                                    style=GRID_STYLE.as_str()
                                                >
                                                    // ------------- GRID HEADER ----------- //
                                                    <GridHeaderDataGrid
                                                        row_count_signal
                                                        selected_count_signal
                                                        handle_select_all
                                                        sort_signals
                                                        pinned_columns_signal
                                                        visible_columns_signal
                                                    />

                                                    // ------------- GRID BODY ----------- //
                                                    <GridBody style=grid_body_height>
                                                        <For
                                                            each=move || sorted_rows_signal.get()
                                                            key=|row| row.name.clone()
                                                            children=move |row| {
                                                                let row_name = row.name.clone();
                                                                let index = Signal::derive(move || {
                                                                    sorted_rows_signal
                                                                        .with(|rows| {
                                                                            rows.iter().position(|r| r.name == row_name).unwrap_or(0)
                                                                        })
                                                                });
                                                                let rowindex = Signal::derive(move || index.get() + 2);
                                                                let is_active_signal = RwSignal::new(row.is_active);
                                                                let is_selected = Signal::derive(move || {
                                                                    selected_indices_signal
                                                                        .with(|selected| selected.contains(&index.get()))
                                                                });
                                                                let row = StoredValue::new(row);
                                                                let render_cell_content = move |col: Column| -> AnyView {
                                                                    match col {
                                                                        Column::Website => {
                                                                            let url = row.with_value(|r| r.website.clone());
                                                                            let url_display = url.clone();
                                                                            // Derive index reactively so it updates when rows are deleted
                                                                            // Custom rendering: Website (link), Skills (badges), IsActive (checkbox)
                                                                            // Default: all other columns use GridCellContent with col.get_value()
                                                                            view! {
                                                                                <div
                                                                                    data-slot="grid-cell-content"
                                                                                    class="overflow-hidden size-full"
                                                                                >
                                                                                    <a
                                                                                        href=url
                                                                                        target="_blank"
                                                                                        rel="noopener noreferrer"
                                                                                        class="underline truncate text-primary decoration-primary/30 underline-offset-2 hover:decoration-primary/60"
                                                                                    >
                                                                                        {url_display}
                                                                                    </a>
                                                                                </div>
                                                                            }
                                                                                .into_any()
                                                                        }
                                                                        Column::Skills => {
                                                                            view! {
                                                                                <div class="flex overflow-hidden flex-wrap gap-1 items-center">
                                                                                    {row
                                                                                        .with_value(|r| r.skills.clone())
                                                                                        .into_iter()
                                                                                        .map(|skill| {
                                                                                            view! {
                                                                                                <Badge variant=BadgeVariant::Secondary>{skill}</Badge>
                                                                                            }
                                                                                        })
                                                                                        .collect_view()}
                                                                                </div>
                                                                            }
                                                                                .into_any()
                                                                        }
                                                                        Column::IsActive => {
                                                                            view! {
                                                                                <Checkbox
                                                                                    checked=is_active_signal
                                                                                    on_checked_change=Callback::new(move |checked| {
                                                                                        is_active_signal.set(checked)
                                                                                    })
                                                                                    aria_label="Active"
                                                                                />
                                                                            }
                                                                                .into_any()
                                                                        }
                                                                        Column::Select | Column::Attachments => {
                                                                            view! { <div /> }.into_any()
                                                                        }
                                                                        _ => {
                                                                            let value = row.with_value(|r| col.get_value(r));
                                                                            view! {
                                                                                <EditableCellContent
                                                                                    row_idx=index.get()
                                                                                    col=col
                                                                                    value=value
                                                                                />
                                                                            }
                                                                                .into_any()
                                                                        }
                                                                    }
                                                                };

                                                                // rowindex starts at 2 because row 1 is the header
                                                                view! {
                                                                    <ContextMenu>
                                                                        <ContextMenuTrigger>
                                                                            <GridRow rowindex=rowindex.get() index=index>
                                                                                <GridSelectCell>
                                                                                    <div class="py-1.5 px-3 size-full">
                                                                                        <Checkbox
                                                                                            checked=is_selected
                                                                                            on_checked_change=Callback::new(move |checked| {
                                                                                                let idx = index.get();
                                                                                                selected_indices_signal
                                                                                                    .update(|selected| {
                                                                                                        if checked {
                                                                                                            selected.insert(idx);
                                                                                                        } else {
                                                                                                            selected.remove(&idx);
                                                                                                        }
                                                                                                    });
                                                                                            })
                                                                                            aria_label="Select row"
                                                                                        />
                                                                                    </div>
                                                                                </GridSelectCell>
                                                                                // Pinned cells (dynamic loop) - only show if both pinned AND visible
                                                                                <For
                                                                                    each=move || get_pinned_visible_columns(
                                                                                        pinned_columns_signal,
                                                                                        visible_columns_signal,
                                                                                    )
                                                                                    key=|(col, _)| *col
                                                                                    children=move |(col, _width)| {
                                                                                        view! {
                                                                                            <GridPinnedCell
                                                                                                col=col
                                                                                                pinned_columns_signal=pinned_columns_signal
                                                                                            >
                                                                                                <GridCellWrapper class=col
                                                                                                    .wrapper_class()>
                                                                                                    {render_cell_content(col)}
                                                                                                </GridCellWrapper>
                                                                                            </GridPinnedCell>
                                                                                        }
                                                                                            .into_any()
                                                                                    }
                                                                                />
                                                                                // Non-pinned cells (dynamic loop)
                                                                                <For
                                                                                    each=move || { PINNABLE_COLUMNS.to_vec() }
                                                                                    key=|(col, _)| *col
                                                                                    children=move |(col, _width)| {
                                                                                        view! {
                                                                                            <GridCell
                                                                                                colindex=col.colindex()
                                                                                                column=col.css_safe_name()
                                                                                                visible=col
                                                                                                    .is_visible(pinned_columns_signal, visible_columns_signal)
                                                                                                active=Signal::derive(move || {
                                                                                                    cell_selection.is_active(index.get(), col)
                                                                                                })
                                                                                                current=Signal::derive(move || {
                                                                                                    cell_selection.is_context_menu(index.get(), col)
                                                                                                })
                                                                                                in_range=Signal::derive(move || {
                                                                                                    drag_selection.is_cell_in_range(index.get(), col)
                                                                                                })
                                                                                                on_click=Callback::new(move |_| {
                                                                                                    cell_selection.handle_click(index.get(), col);
                                                                                                    drag_selection.clear_selection();
                                                                                                })
                                                                                                on_contextmenu=Callback::new(move |_| {
                                                                                                    cell_selection.start_contextmenu();
                                                                                                    if drag_selection.handle_contextmenu(index.get(), col) {
                                                                                                        cell_selection.set_active(index.get(), col);
                                                                                                    }
                                                                                                    cell_selection.set_context_menu(index.get(), col);
                                                                                                    let value = row.with_value(|r| col.get_value(r));
                                                                                                    copy_value_signal.set(value);
                                                                                                })
                                                                                                on_mousedown=Callback::new(move |_| {
                                                                                                    cell_selection.set_active(index.get(), col);
                                                                                                    drag_selection.start_drag(index.get(), col);
                                                                                                })
                                                                                                on_mouseenter=Callback::new(move |_| {
                                                                                                    drag_selection.update_drag(index.get(), col);
                                                                                                })
                                                                                            >
                                                                                                <GridCellWrapper class=col
                                                                                                    .wrapper_class()>
                                                                                                    {render_cell_content(col)}
                                                                                                </GridCellWrapper>
                                                                                            </GridCell>
                                                                                        }
                                                                                            .into_any()
                                                                                    }
                                                                                />
                                                                            </GridRow>
                                                                        </ContextMenuTrigger>
                                                                        // Clear cell highlights when context menu closes (unless reopening on another cell)
                                                                        <ContextMenuContent on_close=Callback::new(move |_| {
                                                                            cell_selection.handle_contextmenu_close();
                                                                        })>
                                                                            <ContextMenuGroup>
                                                                                <ContextMenuItem on:click=move |_| {
                                                                                    let value = drag_selection
                                                                                        .collect_selection_values(
                                                                                            &sorted_rows_signal.get(),
                                                                                            PINNABLE_COLUMNS,
                                                                                            |row, col| col.get_value(row),
                                                                                        )
                                                                                        .unwrap_or_else(|| copy_value_signal.get());
                                                                                    if !value.is_empty() {
                                                                                        copy_to_clipboard.with_value(|copy_fn| copy_fn(&value));
                                                                                        expect_toaster().success("Copied to clipboard");
                                                                                    }
                                                                                }>
                                                                                    <ContextMenuAction>
                                                                                        <Copy />
                                                                                        <span>"Copy"</span>
                                                                                    </ContextMenuAction>
                                                                                </ContextMenuItem>
                                                                                <ContextMenuItem>
                                                                                    <ContextMenuAction>
                                                                                        <Scissors />
                                                                                        <span>"Cut"</span>
                                                                                    </ContextMenuAction>
                                                                                </ContextMenuItem>
                                                                                <ContextMenuItem>
                                                                                    <ContextMenuAction>
                                                                                        <Eraser />
                                                                                        <span>"Clear"</span>
                                                                                    </ContextMenuAction>
                                                                                </ContextMenuItem>
                                                                            </ContextMenuGroup>
                                                                            <Separator class="my-1" />
                                                                            <ContextMenuItem class="p-0">
                                                                                <PressHoldDeleteRow
                                                                                    index=index
                                                                                    drag_selection=drag_selection
                                                                                    cell_selection=cell_selection
                                                                                    sorted_rows_signal=sorted_rows_signal
                                                                                    handle_delete_rows=handle_delete_rows
                                                                                />
                                                                            </ContextMenuItem>
                                                                        </ContextMenuContent>
                                                                    </ContextMenu>
                                                                }
                                                            }
                                                        />
                                                        // Add row button at the bottom
                                                        <GridAddRow rows_signal row_count_signal />
                                                    </GridBody>
                                                </Grid>
                                            </GridWrapper>
                                        </div>
                                    }
                                        .into_any()
                                }
                                Err(err) => {
                                    view! {
                                        <div class="py-3 px-4 text-red-700 bg-red-100 rounded border border-red-400">
                                            <p class="font-medium">"Error loading data: " {err.to_string()}</p>
                                        </div>
                                    }
                                        .into_any()
                                }
                            }
                        })
                }}
            </Transition>
        </div>
    }
}

/* ========================================================== */
/*                     ✨ FUNCTIONS ✨                        */
/* ========================================================== */

#[component]
pub fn ToolbarDataGrid(visible_columns_signal: RwSignal<HashSet<String>>) -> impl IntoView {
    view! {
        <DataGridToolbar class="justify-end">
            // Column visibility multi-select
            <MultiSelect values=visible_columns_signal align=MultiSelectAlign::End>
                <MultiSelectTrigger>
                    <Settings2 class="text-muted-foreground" />
                    <span>"View"</span>
                </MultiSelectTrigger>
                <MultiSelectContent>
                    <MultiSelectGroup>
                        {Column::iter()
                            .filter(|c| *c != Column::Select)
                            .map(|column| {
                                let column_str = column.to_string();
                                let is_disabled = column.is_disabled();
                                view! {
                                    <MultiSelectItem>
                                        <MultiSelectOption value=column_str.clone() attr:disabled=is_disabled>
                                            {column_str}
                                        </MultiSelectOption>
                                    </MultiSelectItem>
                                }
                            })
                            .collect_view()}
                    </MultiSelectGroup>
                </MultiSelectContent>
            </MultiSelect>
        </DataGridToolbar>
    }
}

#[component]
pub fn GridHeaderDataGrid(
    row_count_signal: Signal<usize>,
    selected_count_signal: Signal<usize>,
    handle_select_all: Callback<bool>,
    sort_signals: StoredValue<std::collections::HashMap<Column, RwSignal<SortDirection>>>,
    pinned_columns_signal: RwSignal<HashSet<Column>>,
    visible_columns_signal: RwSignal<HashSet<String>>,
) -> impl IntoView {
    view! {
        <div role="rowgroup" data-slot="grid-header" class="grid sticky top-0 z-10 border-b bg-background">
            <div role="row" aria-rowindex="1" data-slot="grid-header-row" tabindex="-1" class="flex w-full">
                <GridSelectHeaderCell>
                    <div class="py-1.5 px-3 size-full">
                        <Checkbox
                            checked=Signal::derive(move || {
                                let row_count = row_count_signal.get();
                                row_count > 0 && selected_count_signal.get() == row_count
                            })
                            on_checked_change=handle_select_all
                            aria_label="Select all"
                        />
                    </div>
                </GridSelectHeaderCell>
                // Pinned headers (dynamic loop) - only show if both pinned AND visible
                <For
                    each=move || get_pinned_visible_columns(pinned_columns_signal, visible_columns_signal)
                    key=|(col, _)| *col
                    children=move |(col, _width)| {
                        let sort_signal = sort_signals.with_value(|s| s.get(&col).copied());
                        let Some(sort_signal) = sort_signal else {
                            return view! { <div></div> }.into_any();
                        };
                        let left = pinned_columns_signal.with(|p| get_pinned_left_position(col, p));
                        let width = get_column_width(col);

                        view! {
                            <GridPinnedHeaderCell left=left width=width>
                                <PinnableSortableHeaderCell
                                    column=col
                                    label=col.to_string()
                                    sort_signal=sort_signal
                                    pinned_columns_signal=pinned_columns_signal
                                    visible_columns_signal=visible_columns_signal
                                    is_pinned=true
                                />
                            </GridPinnedHeaderCell>
                        }
                            .into_any()
                    }
                />
                // Non-pinned headers (dynamic loop)
                <For
                    each=move || PINNABLE_COLUMNS.to_vec()
                    key=|(col, _)| *col
                    children=move |(col, _width)| {
                        let sort_signal = sort_signals.with_value(|s| s.get(&col).copied());
                        let Some(sort_signal) = sort_signal else {
                            return view! { <div></div> }.into_any();
                        };
                        view! {
                            <GridHeaderCell
                                colindex=col.colindex()
                                column=col.css_safe_name()
                                visible=col.is_visible(pinned_columns_signal, visible_columns_signal)
                            >
                                <PinnableSortableHeaderCell
                                    column=col
                                    label=col.to_string()
                                    sort_signal=sort_signal
                                    pinned_columns_signal=pinned_columns_signal
                                    visible_columns_signal=visible_columns_signal
                                />
                            </GridHeaderCell>
                        }
                            .into_any()
                    }
                />
            // grid-header-row
            </div>
        </div>
    }
}

#[component]
fn PressHoldDeleteRow(
    index: Signal<usize>,
    drag_selection: crate::hooks::use_drag_selection::UseDragSelection<Column>,
    cell_selection: crate::hooks::use_cell_selection::UseCellSelection<Column>,
    sorted_rows_signal: Memo<Vec<RowData>>,
    handle_delete_rows: Callback<Vec<String>>,
) -> impl IntoView {
    let on_delete = Callback::new(move |_| {
        let idx = index.get();
        let (min_row, max_row) =
            drag_selection.get_selection_bounds().map(|(min, max, _, _)| (min, max)).unwrap_or((idx, idx));

        let sorted = sorted_rows_signal.get();
        let names_to_delete: Vec<String> =
            (min_row..=max_row).filter_map(|i| sorted.get(i).map(|r| r.name.clone())).collect();

        let count = names_to_delete.len();
        handle_delete_rows.run(names_to_delete);
        drag_selection.clear_selection();
        cell_selection.clear_all();

        let suffix = if count == 1 { "" } else { "s" };
        expect_toaster().success(format!("Deleted {} row{}", count, suffix));
    });

    let disabled = Signal::derive(|| false);
    let press_hold = use_press_hold(1500, on_delete, disabled);

    let ph1 = press_hold.clone();
    let ph2 = press_hold.clone();
    let ph3 = press_hold.clone();
    let ph4 = press_hold.clone();

    let progress_style = move || {
        let width_percent = press_hold.progress_signal.get() * 100.0;
        format!(
            "position: absolute; left: 0; top: 0; bottom: 0; width: {width_percent:.1}%; background: rgba(239, 68, 68, 0.3); pointer-events: none; border-radius: inherit;"
        )
    };

    let is_multi_row =
        move || drag_selection.get_selection_bounds().is_some_and(|(min_row, max_row, _, _)| max_row > min_row);

    view! {
        <button
            class="flex relative gap-2 items-center py-1.5 px-2 w-full text-sm rounded-sm transition-colors select-none text-destructive hover:bg-destructive/10"
            on:pointerdown=move |_| ph1.on_pointer_down()
            on:pointerup=move |_| ph2.on_pointer_up()
            on:pointerleave=move |_| ph3.on_pointer_up()
            on:pointercancel=move |_| ph4.on_pointer_up()
        >
            <span style=progress_style></span>
            <span class="flex relative z-10 gap-2 items-center">
                <Trash2 class="size-4" />
                {move || if is_multi_row() { "Hold to delete rows" } else { "Hold to delete row" }}
            </span>
        </button>
    }
}

/* ========================================================== */
/*                     ✨ FUNCTIONS ✨                        */
/* ========================================================== */

/// Add row button at the bottom of the grid using absolute positioning.
#[component]
fn GridAddRow(rows_signal: RwSignal<Vec<RowData>>, row_count_signal: Signal<usize>) -> impl IntoView {
    let rowindex = Signal::derive(move || row_count_signal.get() + 2);

    let handle_add_row = move |_| {
        rows_signal.update(|rows| {
            // Generate unique name for new row
            let new_row_num = rows.len() + 1;
            let new_name = format!("New Row {new_row_num}");
            rows.push(RowData { name: new_name, ..Default::default() });
        });
    };

    view! {
        <div
            role="row"
            aria-rowindex=move || rowindex.get().to_string()
            data-slot="grid-add-row"
            tabindex="-1"
            class="flex absolute w-full border-b transition-colors cursor-pointer bg-muted/30 hover:bg-muted/50"
            style=move || {
                let translate_y = row_count_signal.get() * 36;
                format!("height: 36px; transform: translateY({translate_y}px);")
            }
            on:click=handle_add_row
        >
            <div class="flex sticky left-0 gap-2 items-center px-3 text-muted-foreground">
                <Plus class="size-3.5" />
                <span class="text-sm">"Add row"</span>
            </div>
        </div>
    }
}

so model doesn't waste tokens
similarly tyhis as well
ui add demo_data_table
use std::collections::HashSet;

use icons::{ArrowUpDown, Ellipsis, Plus, Trash};
use leptos::portal::Portal;
use leptos::prelude::*;
use strum::{AsRefStr, Display, EnumString};

use crate::ui::alert_dialog::{
    AlertDialog, AlertDialogBody, AlertDialogClose, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
    AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
};
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::checkbox::Checkbox;
use crate::ui::data_table::{
    DataTable, DataTableBody, DataTableCell, DataTableHead, DataTableHeader, DataTableRow, DataTableWrapper,
};
use crate::ui::dropdown_menu::{
    DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
};
use crate::ui::input::Input;
use crate::ui::multi_select::{
    MultiSelect, MultiSelectContent, MultiSelectGroup, MultiSelectItem, MultiSelectOption, MultiSelectTrigger,
    MultiSelectValue,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
enum SortOrder {
    #[default]
    Asc,
    Desc,
}

const COLUMNS: [&str; 3] = ["Status", "Email", "Amount"];

#[component]
pub fn DemoDataTable() -> impl IntoView {
    let selected_emails_signal = RwSignal::new(HashSet::<&'static str>::new());
    let fake_payment_count_signal = RwSignal::new(0_usize);
    let columns_signal = RwSignal::new(HashSet::from(COLUMNS.map(|c| c.to_string())));
    let sort_order_signal = RwSignal::new(SortOrder::default());
    let email_filter_signal = RwSignal::new(String::new());
    let deleted_ids_signal = RwSignal::new(HashSet::<usize>::new());

    let sorted_payments_signal = Memo::new(move |_| {
        let filter = email_filter_signal.get().to_lowercase();
        let mut payments: Vec<Payment> = INITIAL_PAYMENTS.to_vec();

        let count = fake_payment_count_signal.get();
        for i in 0..count {
            payments.push(Payment::new(1000 + i));
        }

        // Filter out deleted payments
        payments.retain(|payment| {
            !deleted_ids_signal.with(|deleted| deleted.contains(&payment.id))
                && payment.email.to_lowercase().contains(&filter)
        });

        match sort_order_signal.get() {
            SortOrder::Asc => payments.sort_by(|a, b| a.email.cmp(b.email)),
            SortOrder::Desc => payments.sort_by(|a, b| b.email.cmp(a.email)),
        }
        payments
    });

    let selected_count_signal = Signal::derive(move || {
        sorted_payments_signal.with(|payments| {
            selected_emails_signal
                .with(|selected| payments.iter().filter(|payment| selected.contains(&payment.email)).count())
        })
    });

    let handle_select_all = Callback::new(move |checked: bool| {
        selected_emails_signal.update(|selected| {
            sorted_payments_signal.with(|payments| {
                for payment in payments {
                    if checked {
                        selected.insert(payment.email);
                    } else {
                        selected.remove(payment.email);
                    }
                }
            });
        });
    });

    view! {
        <div class="py-8 w-full">
            <div class="flex gap-4 items-center mb-4">
                <Input
                    class="max-w-sm"
                    attr:placeholder="Filter emails..."
                    prop:value=move || email_filter_signal.get()
                    on:input=move |ev| email_filter_signal.set(event_target_value(&ev))
                />
                <MultiSelect values=columns_signal>
                    <MultiSelectTrigger class="ml-auto w-[150px]">
                        <MultiSelectValue placeholder="Columns" />
                    </MultiSelectTrigger>
                    <MultiSelectContent>
                        <MultiSelectGroup>
                            {COLUMNS
                                .into_iter()
                                .map(|column| {
                                    let is_email = column == "Email";
                                    view! {
                                        <MultiSelectItem>
                                            <MultiSelectOption value=column attr:disabled=is_email>
                                                {column}
                                            </MultiSelectOption>
                                        </MultiSelectItem>
                                    }
                                })
                                .collect_view()}
                        </MultiSelectGroup>
                    </MultiSelectContent>
                </MultiSelect>
                <Button
                    size=ButtonSize::Icon
                    variant=ButtonVariant::Outline
                    on:click=move |_| {
                        fake_payment_count_signal.update(|count| *count += 1);
                    }
                >
                    <Plus class="text-muted-foreground" />
                </Button>
            </div>

            <DataTableWrapper>
                <DataTable>
                    <DataTableHeader>
                        <DataTableRow>
                            <DataTableHead class="px-4">
                                <Checkbox
                                    attr:aria-label="Select all"
                                    checked=Signal::derive(move || {
                                        sorted_payments_signal
                                            .with(|payments| {
                                                !payments.is_empty() && selected_count_signal.get() == payments.len()
                                            })
                                    })
                                    on_checked_change=handle_select_all
                                />
                            </DataTableHead>
                            {move || {
                                columns_signal
                                    .get()
                                    .contains("Status")
                                    .then(|| {
                                        view! { <DataTableHead class="px-4">Status</DataTableHead> }
                                    })
                            }}

                            {move || {
                                columns_signal
                                    .get()
                                    .contains("Email")
                                    .then(|| {
                                        view! {
                                            <DataTableHead class="px-4">
                                                <Button
                                                    variant=ButtonVariant::Ghost
                                                    on:click=move |_| {
                                                        sort_order_signal
                                                            .update(|order| {
                                                                *order = match *order {
                                                                    SortOrder::Asc => SortOrder::Desc,
                                                                    SortOrder::Desc => SortOrder::Asc,
                                                                };
                                                            });
                                                    }
                                                >
                                                    <span>Email</span>
                                                    <ArrowUpDown class="ml-2" />
                                                </Button>
                                            </DataTableHead>
                                        }
                                    })
                            }}

                            {move || {
                                columns_signal
                                    .get()
                                    .contains("Amount")
                                    .then(|| {
                                        view! { <DataTableHead class="px-4 text-right">Amount</DataTableHead> }
                                    })
                            }}

                            <DataTableHead class="px-4">""</DataTableHead>
                        </DataTableRow>
                    </DataTableHeader>
                    <DataTableBody>
                        <For each=move || sorted_payments_signal.get() key=|payment| payment.id let:payment>
                            {
                                let is_selected = Signal::derive(move || {
                                    selected_emails_signal.with(|selected| selected.contains(payment.email))
                                });
                                view! {
                                    <DataTableRow attr:data-state=move || {
                                        if is_selected.get() { "selected" } else { "" }
                                    }>
                                        <DataTableCell>
                                            <Checkbox
                                                checked=is_selected
                                                on_checked_change=Callback::new(move |checked| {
                                                    selected_emails_signal
                                                        .update(|selected| {
                                                            if checked {
                                                                selected.insert(payment.email);
                                                            } else {
                                                                selected.remove(payment.email);
                                                            }
                                                        });
                                                })
                                            />
                                        </DataTableCell>
                                        {move || {
                                            columns_signal
                                                .get()
                                                .contains("Status")
                                                .then(|| {
                                                    view! {
                                                        <DataTableCell>{payment.status.to_string()}</DataTableCell>
                                                    }
                                                })
                                        }}

                                        {move || {
                                            columns_signal
                                                .get()
                                                .contains("Email")
                                                .then(|| {
                                                    view! { <DataTableCell>{payment.email}</DataTableCell> }
                                                })
                                        }}

                                        {move || {
                                            columns_signal
                                                .get()
                                                .contains("Amount")
                                                .then(|| {
                                                    view! {
                                                        <DataTableCell class="font-medium text-right">
                                                            {format!("${:.2}", payment.amount)}
                                                        </DataTableCell>
                                                    }
                                                })
                                        }}

                                        <DataTableCell>
                                            <DropdownMenu>
                                                <DropdownMenuTrigger class="flex justify-center items-center p-0 w-8 h-8">
                                                    <span class="hidden">Open menu</span>
                                                    <Ellipsis class="size-4" />
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent class="w-[160px]">
                                                    <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                                    <DropdownMenuGroup class="mt-2">
                                                        <DropdownMenuItem class="p-0">
                                                            <AlertDialog class="w-full">
                                                                <AlertDialogTrigger class="w-full">
                                                                    <Trash class="text-destructive" />
                                                                    <span>Delete</span>
                                                                </AlertDialogTrigger>

                                                                <Portal>
                                                                    <AlertDialogContent class="w-[425px]">
                                                                        <AlertDialogBody>
                                                                            <AlertDialogHeader>
                                                                                <AlertDialogTitle>
                                                                                    "Are you absolutely sure?"
                                                                                </AlertDialogTitle>

                                                                                <AlertDialogDescription>
                                                                                    "This action cannot be undone. This will permanently delete the payment record for "
                                                                                    <strong>{payment.email}</strong> "."
                                                                                </AlertDialogDescription>
                                                                            </AlertDialogHeader>

                                                                            <AlertDialogFooter>
                                                                                <AlertDialogClose>"Cancel"</AlertDialogClose>
                                                                                <Button
                                                                                    variant=ButtonVariant::Destructive
                                                                                    on:click=move |_| {
                                                                                        deleted_ids_signal
                                                                                            .update(|deleted| {
                                                                                                deleted.insert(payment.id);
                                                                                            });
                                                                                        selected_emails_signal
                                                                                            .update(|selected| {
                                                                                                selected.remove(payment.email);
                                                                                            });
                                                                                    }
                                                                                >
                                                                                    "Delete"
                                                                                </Button>
                                                                            </AlertDialogFooter>
                                                                        </AlertDialogBody>
                                                                    </AlertDialogContent>
                                                                </Portal>
                                                            </AlertDialog>
                                                        </DropdownMenuItem>
                                                    </DropdownMenuGroup>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </DataTableCell>
                                    </DataTableRow>
                                }
                            }

                        </For>
                    </DataTableBody>
                </DataTable>
            </DataTableWrapper>

            <div class="flex justify-end items-center pt-4 space-x-2">
                <div class="flex-1 text-sm text-muted-foreground">
                    {move || {
                        format!(
                            "{} of {} row(s) selected.",
                            selected_count_signal.get(),
                            sorted_payments_signal.with(|p| p.len()),
                        )
                    }}

                </div>
                <div class="space-x-2">
                    <Button variant=ButtonVariant::Outline size=ButtonSize::Sm attr:disabled>
                        Previous
                    </Button>
                    <Button variant=ButtonVariant::Outline size=ButtonSize::Sm attr:disabled>
                        Next
                    </Button>
                </div>
            </div>
        </div>
    }
}

/* ========================================================== */
/*                     ✨ CONSTANTS ✨                        */
/* ========================================================== */

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Display, EnumString, AsRefStr)]
enum PaymentStatus {
    #[default]
    Processing,
    Failed,
    Success,
}

#[derive(Clone, PartialEq)]
struct Payment {
    id: usize,
    status: PaymentStatus,
    email: &'static str,
    amount: f64,
}

impl Payment {
    fn new(id: usize) -> Self {
        Self { id, status: PaymentStatus::default(), email: "newuser@example.com", amount: 500.00 }
    }
}

const INITIAL_PAYMENTS: &[Payment] = &[
    Payment { id: 1, status: PaymentStatus::Failed, email: "isabella.n@gmail.com", amount: 874.00 },
    Payment { id: 2, status: PaymentStatus::Success, email: "jackson.lee@email.com", amount: 837.00 },
    Payment { id: 3, status: PaymentStatus::Success, email: "ken99@yahoo.com", amount: 316.00 },
    Payment { id: 4, status: PaymentStatus::Processing, email: "olivia@example.com", amount: 242.00 },
    Payment { id: 5, status: PaymentStatus::Success, email: "william@company.com", amount: 721.00 },
];


even this aswell like if i ask dex to book a ticket to smthing it should display a date picker if  i didn't specify the date 
ui add demo_date_picker

if i secify the dtae it should show the picked date here 
ui add demo_date_picker
use icons::{ChevronLeft, ChevronRight};
use leptos::prelude::*;
use time::{Date, Month};

use crate::ui::date_picker::{
    DatePicker, DatePickerCell, DatePickerHeader, DatePickerNavButton, DatePickerRow, DatePickerTitle,
    DatePickerWeekDay,
};
use crate::ui::date_picker_state::{DatePickerDay, DatePickerState};
use crate::utils::query::QueryUtils;

#[component]
pub fn DemoDatePicker() -> impl IntoView {
    // Initialize dates from URL or use defaults
    let Some(default_start) = Date::from_calendar_date(2025, Month::May, 5).ok() else {
        return view! { <p>"Invalid default start date"</p> }.into_any();
    };
    let Some(default_end) = Date::from_calendar_date(2025, Month::May, 14).ok() else {
        return view! { <p>"Invalid default end date"</p> }.into_any();
    };

    let picker_state = DatePickerState::from_url_or_default(default_start, default_end);

    // Extract start and end dates as RwSignal
    let start_date_signal = RwSignal::new(picker_state.get_untracked().start_date);
    let end_date_signal = RwSignal::new(picker_state.get_untracked().end_date);

    // Track which month is currently displayed (independent from selected dates)
    let display_date_signal = RwSignal::new(picker_state.get_untracked().start_date);

    // Sync local signals with picker_state when URL changes
    Effect::new(move |_| {
        let state = picker_state.get();
        start_date_signal.set(state.start_date);
        end_date_signal.set(state.end_date);
        // Don't reset display_date_signal here - let user navigation control it
    });

    // Navigation: Go to previous month
    let go_to_previous_month = move |_| {
        let current = display_date_signal.get();
        let Some(new_date) = (if current.month() == Month::January {
            Date::from_calendar_date(current.year() - 1, Month::December, 1)
        } else {
            Date::from_calendar_date(current.year(), current.month().previous(), 1)
        })
        .ok() else {
            return;
        };
        display_date_signal.set(new_date);
    };

    // Navigation: Go to next month
    let go_to_next_month = move |_| {
        let current = display_date_signal.get();
        let Some(new_date) = (if current.month() == Month::December {
            Date::from_calendar_date(current.year() + 1, Month::January, 1)
        } else {
            Date::from_calendar_date(current.year(), current.month().next(), 1)
        })
        .ok() else {
            return;
        };
        display_date_signal.set(new_date);
    };

    // Handle day click
    let handle_day_click = move |day: u8| {
        if day == 0 {
            return;
        }

        let year = display_date_signal.get().year();
        let month = display_date_signal.get().month();
        let Some(new_date) = Date::from_calendar_date(year, month, day).ok() else { return };

        // Determine which date to update based on proximity (using full dates)
        let current_start = start_date_signal.get();
        let current_end = end_date_signal.get();

        let days_from_start = (new_date - current_start).whole_days().abs();
        let days_from_end = (new_date - current_end).whole_days().abs();

        if days_from_start <= days_from_end {
            start_date_signal.set(new_date);
        } else {
            end_date_signal.set(new_date);
        }

        // Ensure start_date_signal <= end_date_signal by swapping if needed
        if start_date_signal.get() > end_date_signal.get() {
            let temp = start_date_signal.get();
            start_date_signal.set(end_date_signal.get());
            end_date_signal.set(temp);
        }

        QueryUtils::update_dates_url(Some(start_date_signal.get()), Some(end_date_signal.get()));
    };

    view! {
        <DatePicker>
            <DatePickerHeader>
                <DatePickerNavButton
                    class="justify-self-start"
                    attr:title="previous-month"
                    attr:aria-label="Go to previous month"
                    on:click=go_to_previous_month
                >
                    <ChevronLeft />
                </DatePickerNavButton>
                <DatePickerTitle attr:role="presentation">
                    {move || display_date_signal.get().month().to_string()} {move || display_date_signal.get().year()}
                </DatePickerTitle>
                <DatePickerNavButton
                    class="justify-self-end"
                    attr:title="next-month"
                    attr:aria-label="Go to next month"
                    on:click=go_to_next_month
                >
                    <ChevronRight />
                </DatePickerNavButton>
            </DatePickerHeader>

            <table class="space-y-1 w-full border-collapse" role="grid">
                <thead>
                    <tr class="flex">
                        <DatePickerWeekDay attr:aria-label="Monday">Mo</DatePickerWeekDay>
                        <DatePickerWeekDay attr:aria-label="Tuesday">Tu</DatePickerWeekDay>
                        <DatePickerWeekDay attr:aria-label="Wednesday">We</DatePickerWeekDay>
                        <DatePickerWeekDay attr:aria-label="Thursday">Th</DatePickerWeekDay>
                        <DatePickerWeekDay attr:aria-label="Friday">Fr</DatePickerWeekDay>
                        <DatePickerWeekDay attr:aria-label="Saturday">Sa</DatePickerWeekDay>
                        <DatePickerWeekDay attr:aria-label="Sunday">Su</DatePickerWeekDay>
                    </tr>
                </thead>

                <tbody>
                    {move || {
                        let year = display_date_signal.get().year();
                        let month = display_date_signal.get().month();
                        let days = DatePickerState::get_calendar_days(year, month);
                        let weeks: Vec<Vec<DatePickerDay>> = days.chunks(7).map(|chunk| chunk.to_vec()).collect();

                        view! {
                            <For
                                each=move || weeks.clone()
                                key=|week| week.first().map(|d| d.day).unwrap_or(0)
                                children=move |week| {
                                    let year = year;
                                    let month = month;
                                    view! {
                                        <DatePickerRow>
                                            <For
                                                each=move || week.clone()
                                                key=|DatePickerDay { day, disabled }| format!("{day}-{disabled}")
                                                children=move |DatePickerDay { day, disabled }| {
                                                    view! {
                                                        <DatePickerCell
                                                            day=day
                                                            year=year
                                                            month=month
                                                            disabled=disabled
                                                            start_date=start_date_signal
                                                            end_date=end_date_signal
                                                            on_click=handle_day_click
                                                        />
                                                    }
                                                }
                                            />
                                        </DatePickerRow>
                                    }
                                }
                            />
                        }
                    }}
                </tbody>
            </table>
        </DatePicker>
    }
    .into_any()
}


asking for onfirmation

ui add demo_dialog

use leptos::prelude::*;

use crate::ui::button::Button;
use crate::ui::dialog::{
    Dialog, DialogBody, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
    DialogTrigger,
};
use crate::ui::input::Input;
use crate::ui::label::Label;

#[component]
pub fn DemoDialog() -> impl IntoView {
    let name_signal = RwSignal::new("Max Wells".to_string());
    let username_signal = RwSignal::new("@maxwells".to_string());

    view! {
        <Dialog>
            <DialogTrigger>Open Dialog</DialogTrigger>

            <DialogContent class="sm:max-w-[425px]">
                <DialogBody>
                    <DialogHeader>
                        <DialogTitle>"Edit profile"</DialogTitle>

                        <DialogDescription>
                            "Make changes to your profile here. Click save when you're done."
                        </DialogDescription>
                    </DialogHeader>

                    <div class="flex flex-col gap-4 justify-center">
                        <div class="flex flex-col gap-2">
                            <Label html_for="name-1">Name</Label>
                            <Input attr:autofocus=true attr:id="name-1" attr:name="name" prop:value=name_signal />
                        </div>
                        <div class="flex flex-col gap-2">
                            <Label html_for="username-1">Username</Label>
                            <Input attr:id="username-1" attr:name="username" prop:value=username_signal />
                        </div>
                    </div>

                    <DialogFooter>
                        <DialogClose class="w-full sm:w-fit">"Cancel"</DialogClose>
                        <Button attr:r#type="submit" class="w-full sm:w-fit">
                            Save changes
                        </Button>
                    </DialogFooter>
                </DialogBody>
            </DialogContent>
        </Dialog>
    }
}


even this for gen ui
ui add demo_drag_and_drop
like if i tell it to plan somthing and if it wants to ask me reorder i can simpley drag drop thestatemnts 
ui add demo_drag_and_drop
and put submit button kind of like priority

use leptos::prelude::*;

use crate::ui::drag_and_drop::{Draggable, DraggableItem, DraggableZone};

#[component]
pub fn DemoDragAndDrop() -> impl IntoView {
    view! {
        <Draggable class="max-w-2xl">
            <DraggableZone>
                <DraggableItem text="1" />
                <DraggableItem text="2" />
            </DraggableZone>
            <DraggableZone>
                <DraggableItem text="3" />
                <DraggableItem text="4" />
            </DraggableZone>
        </Draggable>
    }
}


ui add demo_dropdown_menu
this for also gen UI if needed and also for model selection in the prompt text input field

even this as well

ui add demo_dropzone
for gen ui and also file upload to input field


even this for gen ui
ui add demo_field
use leptos::prelude::*;

use crate::ui::button::{Button, ButtonVariant};
use crate::ui::checkbox::Checkbox;
use crate::ui::field::{
    Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSeparator, FieldSet, FieldVariant,
};
use crate::ui::input::Input;

#[component]
pub fn DemoField() -> impl IntoView {
    view! {
        <div class="w-full max-w-md">
            <FieldGroup>
                <FieldSet>
                    <FieldLegend>Payment Method</FieldLegend>
                    <FieldDescription>All transactions are secure and encrypted.</FieldDescription>
                    <FieldGroup>
                        <Field>
                            <FieldLabel html_for="card-name">Name on Card</FieldLabel>
                            <Input attr:id="card-name" placeholder="Evil Rabbit" />
                        </Field>
                        <Field>
                            <FieldLabel html_for="card-number">Card Number</FieldLabel>
                            <Input attr:id="card-number" placeholder="1234 5678 9012 3456" />
                            <FieldDescription>Enter your 16-digit card number.</FieldDescription>
                        </Field>
                        <div class="grid grid-cols-3 gap-4">
                            <Field>
                                <FieldLabel html_for="exp-month">Month</FieldLabel>
                                <Input attr:id="exp-month" placeholder="MM" />
                            </Field>
                            <Field>
                                <FieldLabel html_for="exp-year">Year</FieldLabel>
                                <Input attr:id="exp-year" placeholder="YYYY" />
                            </Field>
                            <Field>
                                <FieldLabel html_for="cvv">CVV</FieldLabel>
                                <Input attr:id="cvv" placeholder="123" />
                            </Field>
                        </div>
                    </FieldGroup>
                </FieldSet>
                <FieldSeparator />
                <FieldSet>
                    <FieldLegend>Billing Address</FieldLegend>
                    <FieldDescription>The billing address associated with your payment method.</FieldDescription>
                    <FieldGroup>
                        <Field variant=FieldVariant::Horizontal>
                            <Checkbox attr:id="same-as-shipping" checked=true />
                            <FieldLabel html_for="same-as-shipping" class="font-normal">
                                Same as shipping address
                            </FieldLabel>
                        </Field>
                    </FieldGroup>
                </FieldSet>
                <Field variant=FieldVariant::Horizontal>
                    <Button>"Submit"</Button>
                    <Button variant=ButtonVariant::Outline>"Cancel"</Button>
                </Field>
            </FieldGroup>
        </div>
    }
}


ui add demo_form
this as well for gen ui

use leptos::prelude::*;
use serde::{Deserialize, Serialize};
use validator::Validate;

use crate::hooks::use_form::use_form;
use crate::ui::form::{Form, FormDescription, FormField, FormGroup, FormInput, FormLabel, FormProvider, FormSet};

#[derive(Debug, Clone, Default, Serialize, Deserialize, Validate)]
struct FormData {
    username: String,
    password: String,
}

#[component]
pub fn DemoForm() -> impl IntoView {
    let form = use_form::<FormData>();

    view! {
        <FormProvider form=form>
            <Form class="max-w-md">
                <FormSet>
                    <FormGroup>
                        <FormField field="username">
                            <FormLabel>Username</FormLabel>
                            <FormInput attr:placeholder="Max Wells" />
                            <FormDescription>Choose a unique username for your account.</FormDescription>
                        </FormField>
                        <FormField field="password">
                            <FormLabel>Password</FormLabel>
                            <FormDescription>Must be at least 8 characters long.</FormDescription>
                            <FormInput attr:r#type="password" attr:placeholder="********" />
                        </FormField>
                    </FormGroup>
                </FormSet>
            </Form>
        </FormProvider>
    }
}


ui add demo_input_group for gen ui
use icons::{Check, CreditCard, Info, Mail, Search, Star};
use leptos::prelude::*;

use crate::ui::input_group::{InputGroup, InputGroupAddon, InputGroupAddonAlign, InputGroupInput};

#[component]
pub fn DemoInputGroup() -> impl IntoView {
    view! {
        <div class="grid gap-6 w-full max-w-sm">
            <InputGroup>
                <InputGroupInput placeholder="Search..." />
                <InputGroupAddon>
                    <Search />
                </InputGroupAddon>
            </InputGroup>

            <InputGroup>
                <InputGroupInput placeholder="Enter your email" />
                <InputGroupAddon>
                    <Mail />
                </InputGroupAddon>
            </InputGroup>

            <InputGroup>
                <InputGroupInput placeholder="Card number" />
                <InputGroupAddon>
                    <CreditCard />
                </InputGroupAddon>
                <InputGroupAddon align=InputGroupAddonAlign::InlineEnd>
                    <Check />
                </InputGroupAddon>
            </InputGroup>

            <InputGroup>
                <InputGroupInput placeholder="Card number" />
                <InputGroupAddon align=InputGroupAddonAlign::InlineEnd>
                    <Star />
                    <Info />
                </InputGroupAddon>
            </InputGroup>
        </div>
    }
}



----------------------

ui add demo_input_prompt this for the input feild where i can ask dex to do thing sand drag drop things 


------------------
ui add demo_item if applicable 

use icons::{BadgeCheck, ChevronRight};
use leptos::prelude::*;

use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::item::{Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemSize, ItemTitle, ItemVariant};

#[component]
pub fn DemoItem() -> impl IntoView {
    view! {
        <div class="flex flex-col gap-6 w-full max-w-md">
            <Item variant=ItemVariant::Outline>
                <ItemContent>
                    <ItemTitle>"Basic Item"</ItemTitle>
                    <ItemDescription>"A simple item with title and description."</ItemDescription>
                </ItemContent>
                <ItemActions>
                    <Button variant=ButtonVariant::Outline size=ButtonSize::Sm>
                        "Action"
                    </Button>
                </ItemActions>
            </Item>

            <Item variant=ItemVariant::Outline size=ItemSize::Sm href="#">
                <ItemMedia>
                    <BadgeCheck class="size-5" />
                </ItemMedia>
                <ItemContent>
                    <ItemTitle>"Your profile has been verified."</ItemTitle>
                </ItemContent>
                <ItemActions>
                    <ChevronRight class="size-4" />
                </ItemActions>
            </Item>
        </div>
    }
}

-----------------------------------------------------------------
ui add demo_kbd if applicable 

----------------------------------------------------------------

ui add demo_menubar even this if applicable and aso use this in GENERATIVE UI like above

-----------------------------------------------------------

ui add demo_multi_select for gen ui as well

----------------------------------------------------------
ui add demo_navigation_menu if applicable

-------------------------
ui add demo_pagination for gen ui as well

--------------------------
ui add demo_pressable maybe for notifications 
ui add demo_radio_button if applicable
ui add demo_progress for claude code integration usage
------------------------------------


ui add demo_scroll_area for gen ui as well
use leptos::prelude::*;

use crate::ui::scroll_area::ScrollArea;
use crate::ui::separator::Separator;

#[component]
pub fn DemoScrollArea() -> impl IntoView {
    let tags = (0..=50).rev().map(|i| format!("v1.2.0-beta.{}", i)).collect::<Vec<_>>();

    view! {
        <ScrollArea class="w-48 h-72 rounded-md border">
            <div class="p-4">
                <h4 class="mb-4 text-sm font-medium leading-none">Tags</h4>
                {tags
                    .into_iter()
                    .map(|tag| {
                        view! {
                            <>
                                <div class="text-sm">{tag}</div>
                                <Separator class="my-2" />
                            </>
                        }
                    })
                    .collect_view()}
            </div>
        </ScrollArea>
    }
}

---------------------------------------

ui add demo_slider

for gen ui as well
use leptos::prelude::*;

use crate::ui::slider::Slider;

#[component]
pub fn DemoSlider() -> impl IntoView {
    view! {
        <div class="flex flex-col gap-6">
            <Slider />
            <Slider attr:min="0" attr:max="100" attr:value="40" attr:step="5" />
            <Slider attr:disabled="true" attr:value="80" />
        </div>
    }
}

--------------------------------------------

ui add demo_sonner for notificatiuons 
------------------------------------

ui add demo_spinner if applicable

ui add demo_switch if applicable

------------------------
for side bar navigation https://rust-ui.com/blocks/sidenav#sidenav04




```rust
use icons::PanelLeft;
use leptos::prelude::*;
use leptos_router::StaticSegment;
use leptos_router::components::{Outlet, ParentRoute};
use leptos_router::hooks::use_location;

use crate::components::blocks::sidenav_routes::{DocsRoutes, SidenavRoutes};
use crate::components::blocks::sidenav_routes_selector::SidenavRoutesSelector;
use crate::components::blocks::sidenav_routes_simplified::SidenavRoutesSimplified;
use crate::components::demos::demo_dropdown_menu_user::DemoDropdownMenuUser;
use crate::components::ui::button::{ButtonSize, ButtonVariant};
use crate::components::ui::sheet::{Sheet, SheetContent, SheetContext, SheetDirection, SheetTrigger};
use crate::components::ui::sidenav::{
    Sidenav, SidenavContent, SidenavFooter, SidenavGroup, SidenavGroupContent, SidenavGroupLabel, SidenavHeader,
    SidenavLink, SidenavMenu, SidenavVariant, SidenavWrapper,
};

#[component(transparent)]
pub fn Sidenav04Routes() -> impl MatchNestedRoutes + Clone {
    view! {
        <ParentRoute path=StaticSegment(SidenavRoutes::view_segment()) view=|| view! { <Outlet /> }>
            <ParentRoute
                path=StaticSegment(SidenavRoutes::Sidenav04.as_ref())
                view=move || view! { <SidenavLayout sidenav_route=SidenavRoutes::Sidenav04 /> }
            >
                <SidenavRoutesSimplified />
            </ParentRoute>
        </ParentRoute>
    }
    .into_inner()
}

/* ========================================================== */
/*                     âœ¨ FUNCTIONS âœ¨                        */
/* ========================================================== */

// * ---> Layout with [ðŸ“ OUTLET] for nested routing (SidenavInset).
#[component]
pub fn SidenavLayout(sidenav_route: SidenavRoutes) -> impl IntoView {
    let location = use_location();

    // Determine current section from URL
    let current_section = Memo::new(move |_| {
        let path = location.pathname.get();
        if path.contains(DocsRoutes::Components.as_ref()) { DocsRoutes::Components } else { DocsRoutes::Hooks }
    });

    view! {
        <div class="bg-background">
            <SidenavWrapper attr:style="--sidenav-width:16rem;">
                // * Desktop Sidenav (hidden on mobile) - Floating variant
                <Sidenav variant=SidenavVariant::Floating>
                    <Sidenav04Content current_section sidenav_route />
                </Sidenav>

                // * ---> [ðŸ“ OUTLET] for nested routing (SidenavInset).
                // * Mobile Sheet is rendered in SidenavInsetRight header
                <Outlet />
            </SidenavWrapper>
        </div>
    }
}

/* ========================================================== */
/*                     âœ¨ SHARED CONTENT âœ¨                   */
/* ========================================================== */

/// Shared sidenav content used by both desktop Sidenav and mobile Sheet
#[component]
fn Sidenav04Content(current_section: Memo<DocsRoutes>, sidenav_route: SidenavRoutes) -> impl IntoView {
    // Try to get SheetContext - will be Some when inside a Sheet (mobile), None otherwise (desktop)
    let sheet_ctx = use_context::<SheetContext>();

    view! {
        <SidenavHeader>
            <SidenavRoutesSelector current_section sidenav_route />
        </SidenavHeader>

        <SidenavContent>
            {move || {
                let sheet_target_id = sheet_ctx.as_ref().map(|ctx| ctx.target_id.clone());
                let links = match current_section.get() {
                    DocsRoutes::Components => COMPONENT_LINKS,
                    DocsRoutes::Hooks => HOOKS_LINKS,
                };
                view! {
                    <SidenavGroup>
                        <SidenavGroupLabel>{move || current_section.get().to_title()}</SidenavGroupLabel>
                        <SidenavGroupContent>
                            <SidenavMenu>
                                {links
                                    .iter()
                                    .map(|(href, title)| {
                                        if let Some(ref target_id) = sheet_target_id {
                                            // Wrap in div with data-sheet-close when inside a Sheet (mobile)
                                            view! {
                                                <div data-sheet-close=target_id.clone()>
                                                    <SidenavLink href=*href>{*title}</SidenavLink>
                                                </div>
                                            }
                                                .into_any()
                                        } else {
                                            view! { <SidenavLink href=*href>{*title}</SidenavLink> }.into_any()
                                        }
                                    })
                                    .collect_view()}
                            </SidenavMenu>
                        </SidenavGroupContent>
                    </SidenavGroup>
                }
            }}
        </SidenavContent>

        <SidenavFooter>
            <DemoDropdownMenuUser />
        </SidenavFooter>
    }
}

/* ========================================================== */
/*                     âœ¨ MOBILE SHEET âœ¨                     */
/* ========================================================== */

/// Mobile sheet containing sidenav content - uses the proper Sheet component
#[component]
pub fn Sidenav04MobileSheet(current_section: Memo<DocsRoutes>, sidenav_route: SidenavRoutes) -> impl IntoView {
    view! {
        <Sheet>
            // * Trigger visible only on mobile, positioned in header flow
            <div class="md:hidden">
                <SheetTrigger class="size-7" variant=ButtonVariant::Ghost size=ButtonSize::Icon>
                    <PanelLeft class="size-4" />
                    <span class="hidden">"Toggle Sidenav"</span>
                </SheetTrigger>
            </div>

            <SheetContent
                direction=SheetDirection::Left
                class="p-0 w-[18rem] bg-sidenav text-sidenav-foreground"
                show_close_button=false
            >
                <div class="flex flex-col h-full">
                    <Sidenav04Content current_section sidenav_route />
                </div>
            </SheetContent>
        </Sheet>
    }
}

/* ========================================================== */
/*                     âœ¨ CONSTANTS âœ¨                        */
/* ========================================================== */

// * A simple example with basic links.

const COMPONENT_LINKS: &[(&str, &str)] = &[
    ("/view/sidenav04/docs/components/accordion", "Accordion"),
    ("/view/sidenav04/docs/components/alert", "Alert"),
    ("/view/sidenav04/docs/components/alert-dialog", "Alert Dialog"),
    ("/view/sidenav04/docs/components/button", "Button"),
    ("/view/sidenav04/docs/components/card", "Card"),
    ("/view/sidenav04/docs/components/checkbox", "Checkbox"),
    ("/view/sidenav04/docs/components/dialog", "Dialog"),
];

const HOOKS_LINKS: &[(&str, &str)] = &[
    ("/view/sidenav04/docs/hooks/use-copy-clipboard", "Use Copy Clipboard"),
    ("/view/sidenav04/docs/hooks/use-lock-body-scroll", "Use Lock Body Scroll"),
    ("/view/sidenav04/docs/hooks/use-random", "Use Random"),
];
```


and strictyly use RUST ICONS FROM HERE https://rust-ui.com/icons



FIRST CLONE EVERYTHING FROM https://github.com/rust-ui/ui.git to project directory and MAP ALL THESE UI
 i need eact UI ok? exact typograpohy exact icons and exact color scheme so i want u to clone it compulsory

DOnt do everything in one pass first write a clear plan and then DO it in recommended way choose priorities urself and do it

and also for GENERATIVE UI i want u to uuse every component that we USE IN OUR APP ok? hard code the UI COMPONENTS I WANT LESS MODEL TOKEN USAGE BUT WHIOLE BEING 100% ACCURATE and NO OVERFLOW OR DESIGN ISSUES

and its MIT LICENSED SO NOTHING WILL HAPPEN 

I NEED EXACT UI COMPONENTS

The goal is NOT just to add a few generative UI components.

I want **every reusable UI component we use anywhere in DEX to be available as a Generative UI primitive**.

Build the architecture so that DEX has a unified component registry/schema that the agent can use to dynamically render UI when necessary.

Examples include, but are not limited to:

* Chat messages / bubbles
* Markdown / rich text
* Code blocks
* Alerts
* Confirmations
* Buttons
* Button groups
* Action buttons / hold-to-confirm actions
* Inputs
* Textareas
* Select / combobox
* Multi-select
* Checkboxes
* Radio groups
* Switches
* Sliders
* Tabs
* Accordions / collapsibles
* Dialogs / alert dialogs
* Popovers
* Tooltips
* Dropdown menus
* Command menus
* Slash-command UI
* Chips / tags
* Badges
* Avatars
* Attachments
* File previews
* Images
* Cards
* Card carousels
* Tables
* Data grids
* Forms
* Steppers
* Progress indicators
* Spinners
* Skeletons
* Toasts
* Markers / status indicators
* Task plans
* Task steps
* Execution events
* Browser/action previews
* Screenshots
* Verification results
* Errors
* Success states
* Empty states
* Artifacts
* Any other reusable component we introduce into DEX

The important distinction is:

**The model should NOT generate UI for everything.**

It should decide whether a component is actually useful for the current response.

For example:

User: "What's 25 × 40?"

→ Just return text: "1,000"

Do NOT generate a data grid, card, form, etc.

User: "Compare these 20 products."

→ Generate a structured data table because that improves comprehension.

User: "Plan a trip to Japan."

→ Generate an appropriate planning/structured UI because the information benefits from organization.

User: "Delete these files."

→ Generate a confirmation/action UI because this is an important/destructive action.

User: "Open Instagram and find the latest post."

→ Generate execution/status UI only where useful, including relevant actions, progress, screenshots, verification state, and final artifact.

### Architecture requirement

Do NOT implement this as a collection of hardcoded special cases.

Create a unified, typed Generative UI system.

Conceptually:

User request
↓
Agent / Planner
↓
Decides whether structured UI is useful
↓
Generative UI specification
↓
Component registry
↓
Renderer
↓
DEX UI component

The model should output a structured representation of the UI rather than arbitrary HTML/CSS.

For example, conceptually:

{
"type": "data_table",
"props": {...},
"children": [...]
}

or:

{
"type": "confirmation",
"props": {...}
}

or:

{
"type": "task_plan",
"props": {...},
"children": [...]
}

Every component should have a well-defined schema describing:

* component type
* allowed properties
* allowed children
* events/actions
* loading state
* error state
* accessibility requirements
* rendering behavior
* whether it is appropriate for user-facing output
* whether it requires confirmation
* whether it can contain other Generative UI components

### Important

The Generative UI system must be able to compose components.

For example:

TaskPlan
├── Step
│    ├── Marker
│    └── Status
├── Step
│    ├── BrowserPreview
│    └── Screenshot
└── Step
├── Verification
└── Artifact

Or:

Card
├── Image
├── Badge
├── Text
└── Button

Or:

DataTable
├── filters
├── sortable columns
├── rows
└── actions

The existing components should therefore not exist separately from Generative UI. **They should be the same underlying components.**

If a component is rendered normally by DEX, it should also be possible for the Generative UI system to render it when appropriate.

### UX requirement

The agent should optimize for **the minimum UI necessary to communicate or accomplish the task**, not maximum UI generation.

Rich UI when useful.
Simple text when sufficient.

Do not turn every response into a dashboard.

The final system should feel like an AI operating environment where the interface adapts to the task rather than a static application with random widgets.

Also make the component registry extensible so that when we add a new DEX component in the future, we can expose it to Generative UI without rebuilding the entire system.
" This

and also look at the charts in this landing page https://rust-ui.com/create they seem good and integrate that to the generative UI AS WELL EVERY CHRT AND DIAGRAMS EVERY GRAPHS EVERY TTABLETO GEN UI

and also modle should use GEN UI ONLY WHEN ITS NEEDED LIKE Explaining concepts or stud like PLANNIBG A TRAVEL OR PLANNING TIME TABLE like that stuff

no gen ui when i say it to do takss like change powerplan to recommended or change DNS stuff like that


