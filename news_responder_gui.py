"""
JJ Shay News Comment Responder - GUI Edition
Beautiful Apple-style interface with logos and progress tracking
"""

import tkinter as tk
from tkinter import ttk, messagebox
import threading
import time
import requests
import json
import os
import re
import xml.etree.ElementTree as ET
from datetime import datetime

# Try to import PIL for image handling
try:
    from PIL import Image, ImageTk
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False
    print("Note: Install Pillow for logo display: pip3 install Pillow")

# Try to import gspread
try:
    import gspread
    from google.oauth2.service_account import Credentials
    GSPREAD_AVAILABLE = True
except ImportError:
    GSPREAD_AVAILABLE = False

# ==================== CONFIG ====================
SHEET_ID = "11a-_IWhljPJHeKV8vdke-JiLmm_KCq-bedSceKB0kZI"
SHEET_NAME = "Comments"
GOOGLE_CREDS_FILE = "/Users/johnshay/jj_shay_takeaways/google_service_account.json"
RSS_FEED_URL = "https://rss.app/feeds/bJZbxhVRx0Xx77J3.xml"

# Logo paths
LOGOS = {
    'jjshay': '/Users/johnshay/Downloads/jjshaylogo.png',
    'openai': '/Users/johnshay/Downloads/download (2).png',
    'claude': '/Users/johnshay/Downloads/claude.png',
    'grok': '/Users/johnshay/Downloads/grok.png',
    'gemini': '/Users/johnshay/Downloads/gemini.jpeg',
    'feedly': '/Users/johnshay/Downloads/feedly.png',
    'oneup': '/Users/johnshay/Downloads/oneup.png',
}

# Column indices
COL_DATE = 0
COL_PROFILE_NAME = 1
COL_ID = 2
COL_TYPE = 4
COL_TEXT = 5
COL_INDUSTRY = 10
COL_SUMMARY = 11
COL_LOCATION = 12
COL_COMPANY = 13
COL_CHATGPT = 14
COL_POST_TITLE = 15
COL_POST_CONTENT = 16


class AppleStyleGUI:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title("JJ Shay News Responder")
        self.root.geometry("1100x900")
        self.root.configure(bg='#0d0d0d')

        # Make it look more Apple-like
        self.root.resizable(True, True)

        # Colors - Apple Dark Mode style
        self.colors = {
            'bg_dark': '#0d0d0d',
            'bg_card': '#1c1c1e',
            'bg_input': '#2c2c2e',
            'text_primary': '#ffffff',
            'text_secondary': '#8e8e93',
            'accent_blue': '#0a84ff',
            'accent_green': '#30d158',
            'accent_orange': '#ff9f0a',
            'accent_red': '#ff453a',
            'accent_purple': '#bf5af2',
            'accent_teal': '#64d2ff',
            'border': '#3a3a3c',
            'google_green': '#34a853',
            'feedly_green': '#2bb24c',
            'linkedin_blue': '#0077b5',
        }

        # API Keys (loaded from sheet)
        self.api_keys = {
            'chatgpt': '',
            'claude': '',
            'grok': '',
            'gemini': ''
        }

        # Data
        self.spreadsheet = None
        self.sheet = None
        self.posts_cache = {}
        self.is_processing = False
        self.logo_images = {}

        self.load_logos()
        self.setup_ui()

    def load_logos(self):
        """Load and resize logo images"""
        if not PIL_AVAILABLE:
            return

        for key, path in LOGOS.items():
            try:
                if os.path.exists(path):
                    img = Image.open(path)
                    # Resize to fit (40x40 for small, 60x60 for header)
                    size = (50, 50) if key != 'jjshay' else (70, 70)
                    img = img.resize(size, Image.Resampling.LANCZOS)
                    self.logo_images[key] = ImageTk.PhotoImage(img)
            except Exception as e:
                print(f"Could not load logo {key}: {e}")

    def setup_ui(self):
        """Create the Apple-style UI"""

        # Main container with padding
        main_frame = tk.Frame(self.root, bg=self.colors['bg_dark'])
        main_frame.pack(fill='both', expand=True, padx=30, pady=20)

        # ===== HEADER WITH LOGO =====
        header_frame = tk.Frame(main_frame, bg=self.colors['bg_dark'])
        header_frame.pack(fill='x', pady=(0, 25))

        # JJ Shay Logo
        if 'jjshay' in self.logo_images:
            logo_label = tk.Label(
                header_frame,
                image=self.logo_images['jjshay'],
                bg=self.colors['bg_dark']
            )
            logo_label.pack(side='left', padx=(0, 15))

        title_frame = tk.Frame(header_frame, bg=self.colors['bg_dark'])
        title_frame.pack(side='left')

        title_label = tk.Label(
            title_frame,
            text="JJ Shay News Responder",
            font=('SF Pro Display', 32, 'bold'),
            fg=self.colors['text_primary'],
            bg=self.colors['bg_dark']
        )
        title_label.pack(anchor='w')

        subtitle = tk.Label(
            title_frame,
            text="AI-Powered LinkedIn Comment Response System",
            font=('SF Pro Text', 14),
            fg=self.colors['text_secondary'],
            bg=self.colors['bg_dark']
        )
        subtitle.pack(anchor='w')

        # ===== TECHNOLOGY PIPELINE WITH LOGOS =====
        pipeline_frame = tk.Frame(main_frame, bg=self.colors['bg_card'])
        pipeline_frame.pack(fill='x', pady=(0, 20))
        pipeline_frame.configure(highlightbackground=self.colors['border'], highlightthickness=1)

        pipeline_inner = tk.Frame(pipeline_frame, bg=self.colors['bg_card'])
        pipeline_inner.pack(fill='x', padx=25, pady=20)

        pipeline_header = tk.Label(
            pipeline_inner,
            text="Data Pipeline",
            font=('SF Pro Display', 16, 'bold'),
            fg=self.colors['text_primary'],
            bg=self.colors['bg_card']
        )
        pipeline_header.pack(anchor='w', pady=(0, 15))

        # Pipeline visualization with logos
        pipeline_viz = tk.Frame(pipeline_inner, bg=self.colors['bg_card'])
        pipeline_viz.pack(fill='x')

        self.tech_indicators = {}
        technologies = [
            ('google_sheets', 'Google Sheets', 'Comments Data', self.colors['google_green'], None),
            ('rss', 'Feedly RSS', 'Article Context', self.colors['feedly_green'], 'feedly'),
            ('ai', 'AI Models', 'Response Gen', self.colors['accent_purple'], None),
            ('linkedin', 'OneUp', 'LinkedIn Posting', self.colors['accent_blue'], 'oneup'),
        ]

        for i, (key, name, desc, color, logo_key) in enumerate(technologies):
            tech_frame = tk.Frame(pipeline_viz, bg=self.colors['bg_card'])
            tech_frame.pack(side='left', fill='x', expand=True)

            # Tech box
            tech_box = tk.Frame(tech_frame, bg=self.colors['bg_input'])
            tech_box.pack(pady=5, padx=5)
            tech_box.configure(highlightbackground=self.colors['border'], highlightthickness=1)

            tech_inner = tk.Frame(tech_box, bg=self.colors['bg_input'])
            tech_inner.pack(padx=15, pady=12)

            # Logo or dot
            if logo_key and logo_key in self.logo_images:
                logo_lbl = tk.Label(
                    tech_inner,
                    image=self.logo_images[logo_key],
                    bg=self.colors['bg_input']
                )
                logo_lbl.pack()
                dot = logo_lbl
            else:
                dot = tk.Label(
                    tech_inner,
                    text="●",
                    font=('SF Pro Text', 24),
                    fg=self.colors['text_secondary'],
                    bg=self.colors['bg_input']
                )
                dot.pack()

            name_lbl = tk.Label(
                tech_inner,
                text=name,
                font=('SF Pro Text', 12, 'bold'),
                fg=self.colors['text_primary'],
                bg=self.colors['bg_input']
            )
            name_lbl.pack(pady=(5, 0))

            desc_lbl = tk.Label(
                tech_inner,
                text=desc,
                font=('SF Pro Text', 10),
                fg=self.colors['text_secondary'],
                bg=self.colors['bg_input']
            )
            desc_lbl.pack()

            self.tech_indicators[key] = {'dot': dot, 'color': color, 'box': tech_box}

            # Arrow between items (except last)
            if i < len(technologies) - 1:
                arrow = tk.Label(
                    pipeline_viz,
                    text="→",
                    font=('SF Pro Text', 28, 'bold'),
                    fg=self.colors['accent_blue'],
                    bg=self.colors['bg_card']
                )
                arrow.pack(side='left', padx=8)

        # ===== AI MODELS ROW WITH LOGOS =====
        ai_header = tk.Label(
            main_frame,
            text="AI Response Cascade",
            font=('SF Pro Display', 16, 'bold'),
            fg=self.colors['text_primary'],
            bg=self.colors['bg_dark']
        )
        ai_header.pack(anchor='w', pady=(5, 10))

        cards_frame = tk.Frame(main_frame, bg=self.colors['bg_dark'])
        cards_frame.pack(fill='x', pady=(0, 20))

        # API Status Cards with Logos
        self.api_cards = {}
        apis = [
            ('ChatGPT', 'chatgpt', self.colors['accent_green'], 'Primary', 'openai'),
            ('Claude', 'claude', self.colors['accent_orange'], 'Backup 1', 'claude'),
            ('Grok', 'grok', self.colors['text_primary'], 'Backup 2', 'grok'),
            ('Gemini', 'gemini', self.colors['accent_blue'], 'Backup 3', 'gemini'),
        ]

        for i, (name, key, color, role, logo_key) in enumerate(apis):
            card = self.create_api_card(cards_frame, name, color, role, logo_key)
            card.pack(side='left', padx=(0, 8), fill='x', expand=True)
            self.api_cards[key] = card

            # Arrow between cards (except last)
            if i < len(apis) - 1:
                arrow = tk.Label(
                    cards_frame,
                    text="→",
                    font=('SF Pro Text', 18, 'bold'),
                    fg=self.colors['text_secondary'],
                    bg=self.colors['bg_dark']
                )
                arrow.pack(side='left', padx=4)

        # ===== PROGRESS SECTION =====
        progress_card = tk.Frame(main_frame, bg=self.colors['bg_card'])
        progress_card.pack(fill='x', pady=(0, 15))
        progress_card.configure(highlightbackground=self.colors['border'], highlightthickness=1)

        progress_inner = tk.Frame(progress_card, bg=self.colors['bg_card'])
        progress_inner.pack(fill='x', padx=25, pady=20)

        # Progress header
        progress_header = tk.Frame(progress_inner, bg=self.colors['bg_card'])
        progress_header.pack(fill='x')

        self.progress_title = tk.Label(
            progress_header,
            text="Ready to Process",
            font=('SF Pro Display', 20, 'bold'),
            fg=self.colors['text_primary'],
            bg=self.colors['bg_card']
        )
        self.progress_title.pack(side='left')

        self.progress_percent = tk.Label(
            progress_header,
            text="0%",
            font=('SF Pro Display', 20, 'bold'),
            fg=self.colors['accent_blue'],
            bg=self.colors['bg_card']
        )
        self.progress_percent.pack(side='right')

        # Progress bar
        style = ttk.Style()
        style.theme_use('clam')
        style.configure(
            "Custom.Horizontal.TProgressbar",
            troughcolor=self.colors['bg_input'],
            background=self.colors['accent_blue'],
            thickness=12,
            borderwidth=0
        )

        self.progress_bar = ttk.Progressbar(
            progress_inner,
            style="Custom.Horizontal.TProgressbar",
            length=400,
            mode='determinate'
        )
        self.progress_bar.pack(fill='x', pady=(15, 10))

        # Status description
        self.status_label = tk.Label(
            progress_inner,
            text="Click 'Connect' to begin",
            font=('SF Pro Text', 14),
            fg=self.colors['text_secondary'],
            bg=self.colors['bg_card']
        )
        self.status_label.pack(anchor='w')

        # ===== CURRENT ITEM DISPLAY =====
        current_card = tk.Frame(main_frame, bg=self.colors['bg_card'])
        current_card.pack(fill='both', expand=True, pady=(0, 15))
        current_card.configure(highlightbackground=self.colors['border'], highlightthickness=1)

        current_inner = tk.Frame(current_card, bg=self.colors['bg_card'])
        current_inner.pack(fill='both', expand=True, padx=25, pady=20)

        current_header = tk.Label(
            current_inner,
            text="Live Processing",
            font=('SF Pro Display', 16, 'bold'),
            fg=self.colors['text_primary'],
            bg=self.colors['bg_card']
        )
        current_header.pack(anchor='w', pady=(0, 15))

        # Info rows
        self.info_labels = {}
        info_items = [
            ('commenter', 'Commenter', self.colors['accent_teal']),
            ('industry', 'Industry', self.colors['accent_orange']),
            ('comment', 'Comment', self.colors['text_primary']),
            ('article', 'Article Match', self.colors['accent_green']),
            ('ai_model', 'AI Model', self.colors['accent_purple']),
            ('response', 'Generated Response', self.colors['accent_blue']),
        ]

        for key, label_text, color in info_items:
            row = tk.Frame(current_inner, bg=self.colors['bg_card'])
            row.pack(fill='x', pady=5)

            label = tk.Label(
                row,
                text=f"{label_text}:",
                font=('SF Pro Text', 12, 'bold'),
                fg=color,
                bg=self.colors['bg_card'],
                width=14,
                anchor='e'
            )
            label.pack(side='left')

            value = tk.Label(
                row,
                text="—",
                font=('SF Pro Text', 12),
                fg=self.colors['text_primary'],
                bg=self.colors['bg_card'],
                anchor='w',
                wraplength=750,
                justify='left'
            )
            value.pack(side='left', padx=(10, 0), fill='x', expand=True)

            self.info_labels[key] = value

        # ===== ACTION BUTTONS =====
        button_frame = tk.Frame(main_frame, bg=self.colors['bg_dark'])
        button_frame.pack(fill='x')

        # Connect button
        self.connect_btn = tk.Button(
            button_frame,
            text="Connect to Sheet",
            font=('SF Pro Text', 14, 'bold'),
            fg=self.colors['text_primary'],
            bg=self.colors['accent_blue'],
            activebackground=self.colors['accent_blue'],
            activeforeground=self.colors['text_primary'],
            relief='flat',
            padx=30,
            pady=14,
            cursor='hand2',
            command=self.connect_sheet
        )
        self.connect_btn.pack(side='left')

        # Process NEW button
        self.process_new_btn = tk.Button(
            button_frame,
            text="Process NEW Comments",
            font=('SF Pro Text', 14, 'bold'),
            fg=self.colors['text_primary'],
            bg=self.colors['accent_green'],
            activebackground=self.colors['accent_green'],
            activeforeground=self.colors['text_primary'],
            relief='flat',
            padx=30,
            pady=14,
            cursor='hand2',
            command=lambda: self.start_processing(new_only=True),
            state='disabled'
        )
        self.process_new_btn.pack(side='left', padx=(15, 0))

        # Process ALL button
        self.process_all_btn = tk.Button(
            button_frame,
            text="Regenerate ALL",
            font=('SF Pro Text', 14, 'bold'),
            fg=self.colors['text_primary'],
            bg=self.colors['accent_orange'],
            activebackground=self.colors['accent_orange'],
            activeforeground=self.colors['text_primary'],
            relief='flat',
            padx=30,
            pady=14,
            cursor='hand2',
            command=lambda: self.start_processing(new_only=False),
            state='disabled'
        )
        self.process_all_btn.pack(side='left', padx=(15, 0))

        # Stats label
        self.stats_label = tk.Label(
            button_frame,
            text="",
            font=('SF Pro Text', 13),
            fg=self.colors['text_secondary'],
            bg=self.colors['bg_dark']
        )
        self.stats_label.pack(side='right')

    def create_api_card(self, parent, name, color, role="", logo_key=None):
        """Create an API status card with logo"""
        card = tk.Frame(parent, bg=self.colors['bg_card'])
        card.configure(highlightbackground=self.colors['border'], highlightthickness=1)

        inner = tk.Frame(card, bg=self.colors['bg_card'])
        inner.pack(padx=12, pady=12)

        # Role badge
        if role:
            role_label = tk.Label(
                inner,
                text=role.upper(),
                font=('SF Pro Text', 9, 'bold'),
                fg=color,
                bg=self.colors['bg_card']
            )
            role_label.pack(anchor='w')

        # Logo or dot
        if logo_key and logo_key in self.logo_images:
            logo_lbl = tk.Label(
                inner,
                image=self.logo_images[logo_key],
                bg=self.colors['bg_card']
            )
            logo_lbl.pack(pady=(5, 0))
            card.dot = logo_lbl
        else:
            dot = tk.Label(
                inner,
                text="●",
                font=('SF Pro Text', 14),
                fg=self.colors['text_secondary'],
                bg=self.colors['bg_card']
            )
            dot.pack()
            card.dot = dot

        card.active_color = color

        name_label = tk.Label(
            inner,
            text=name,
            font=('SF Pro Text', 13, 'bold'),
            fg=self.colors['text_primary'],
            bg=self.colors['bg_card']
        )
        name_label.pack(pady=(5, 0))

        status = tk.Label(
            inner,
            text="Not Connected",
            font=('SF Pro Text', 10),
            fg=self.colors['text_secondary'],
            bg=self.colors['bg_card']
        )
        status.pack()
        card.status_label = status

        return card

    def update_api_status(self, api_key, connected):
        """Update API card status"""
        card = self.api_cards.get(api_key)
        if card:
            if connected:
                card.status_label.configure(text="Connected", fg=card.active_color)
                card.configure(highlightbackground=card.active_color, highlightthickness=2)
            else:
                card.status_label.configure(text="Not Available", fg=self.colors['text_secondary'])
                card.configure(highlightbackground=self.colors['border'], highlightthickness=1)

    def update_tech_status(self, tech_key, active, status_text=""):
        """Update technology pipeline indicator"""
        tech = self.tech_indicators.get(tech_key)
        if tech:
            if active:
                tech['box'].configure(highlightbackground=tech['color'], highlightthickness=3)
            else:
                tech['box'].configure(highlightbackground=self.colors['border'], highlightthickness=1)
        self.root.update()

    def highlight_active_ai(self, api_key):
        """Highlight the currently active AI model"""
        for key, card in self.api_cards.items():
            if key == api_key:
                card.configure(highlightbackground=self.colors['accent_green'], highlightthickness=3)
            elif self.api_keys.get(key):
                card.configure(highlightbackground=card.active_color, highlightthickness=2)
            else:
                card.configure(highlightbackground=self.colors['border'], highlightthickness=1)
        self.root.update()

    def update_status(self, message, progress=None):
        """Update status message and progress bar"""
        self.status_label.configure(text=message)
        if progress is not None:
            self.progress_bar['value'] = progress
            self.progress_percent.configure(text=f"{int(progress)}%")
        self.root.update()

    def update_progress_title(self, title):
        """Update the progress section title"""
        self.progress_title.configure(text=title)
        self.root.update()

    def update_info(self, key, value):
        """Update info display"""
        if key in self.info_labels:
            display_value = str(value)[:200] + "..." if len(str(value)) > 200 else str(value)
            self.info_labels[key].configure(text=display_value or "—")
        self.root.update()

    def clear_info(self):
        """Clear all info labels"""
        for label in self.info_labels.values():
            label.configure(text="—")
        self.root.update()

    def connect_sheet(self):
        """Connect to Google Sheet and load API keys"""
        self.update_status("Connecting to Google Sheet...", 0)
        self.update_progress_title("Connecting")

        def connect_thread():
            try:
                if not GSPREAD_AVAILABLE:
                    self.root.after(0, lambda: messagebox.showerror("Error", "gspread not installed. Run: pip3 install gspread google-auth"))
                    return

                scopes = [
                    'https://www.googleapis.com/auth/spreadsheets',
                    'https://www.googleapis.com/auth/drive'
                ]

                self.root.after(0, lambda: self.update_status("Loading Google credentials...", 10))

                creds = Credentials.from_service_account_file(GOOGLE_CREDS_FILE, scopes=scopes)
                client = gspread.authorize(creds)

                self.root.after(0, lambda: self.update_status("Connecting to Google Sheets...", 25))

                self.spreadsheet = client.open_by_key(SHEET_ID)
                self.sheet = self.spreadsheet.worksheet(SHEET_NAME)

                # Light up Google Sheets indicator
                self.root.after(0, lambda: self.update_tech_status('google_sheets', True))

                self.root.after(0, lambda: self.update_status("Loading API keys from sheet...", 40))

                # Load API keys from "API KEY" tab
                try:
                    api_sheet = self.spreadsheet.worksheet("API KEY")
                    all_values = api_sheet.get_all_values()

                    if len(all_values) >= 6:
                        self.api_keys['claude'] = all_values[4][1] if len(all_values[4]) > 1 else ""
                        self.api_keys['chatgpt'] = all_values[5][1] if len(all_values[5]) > 1 else ""
                    if len(all_values) >= 8:
                        self.api_keys['grok'] = all_values[7][1] if len(all_values[7]) > 1 else ""
                    if len(all_values) >= 10:
                        self.api_keys['gemini'] = all_values[9][1] if len(all_values[9]) > 1 else ""

                    # Update API status cards
                    for key in ['chatgpt', 'claude', 'grok', 'gemini']:
                        self.root.after(0, lambda k=key: self.update_api_status(k, bool(self.api_keys.get(k))))

                    # Light up AI indicator
                    if any(self.api_keys.values()):
                        self.root.after(0, lambda: self.update_tech_status('ai', True))

                except Exception as e:
                    self.root.after(0, lambda err=e: self.update_status(f"Warning: Could not load API keys: {err}", 50))

                self.root.after(0, lambda: self.update_status("Loading Feedly RSS feed...", 60))
                self.refresh_rss_feed()

                # Light up RSS indicator
                self.root.after(0, lambda: self.update_tech_status('rss', True))

                self.root.after(0, lambda: self.update_status("Counting comments...", 80))

                # Count rows
                all_data = self.sheet.get_all_values()
                total_rows = len(all_data) - 1
                new_rows = sum(1 for row in all_data[1:] if len(row) <= COL_CHATGPT or not row[COL_CHATGPT] or len(row[COL_CHATGPT]) < 20)

                # Light up LinkedIn/OneUp indicator
                self.root.after(0, lambda: self.update_tech_status('linkedin', True))

                self.root.after(0, lambda: self.stats_label.configure(text=f"{total_rows} comments  |  {new_rows} need responses"))
                self.root.after(0, lambda: self.update_status(f"Connected! {total_rows} comments found, {new_rows} need responses", 100))
                self.root.after(0, lambda: self.update_progress_title("Ready"))

                # Enable buttons
                self.root.after(0, lambda: self.process_new_btn.configure(state='normal'))
                self.root.after(0, lambda: self.process_all_btn.configure(state='normal'))
                self.root.after(0, lambda: self.connect_btn.configure(text="Reconnect", bg=self.colors['bg_input']))

            except Exception as e:
                self.root.after(0, lambda err=e: self.update_status(f"Connection failed: {str(err)}", 0))
                self.root.after(0, lambda: self.update_progress_title("Error"))
                self.root.after(0, lambda err=e: messagebox.showerror("Connection Error", str(err)))

        threading.Thread(target=connect_thread, daemon=True).start()

    def refresh_rss_feed(self):
        """Fetch and parse RSS feed"""
        try:
            response = requests.get(RSS_FEED_URL, timeout=10)
            response.raise_for_status()

            root = ET.fromstring(response.content)

            for item in root.findall('.//item'):
                title = item.find('title')
                description = item.find('description')
                link = item.find('link')
                guid = item.find('guid')

                if link is not None:
                    post_url = link.text
                    post_data = {
                        "title": title.text if title is not None else "",
                        "description": self.clean_html(description.text) if description is not None else "",
                        "link": post_url,
                    }

                    self.posts_cache[post_url] = post_data

                    activity_match = re.search(r'activity[:\-](\d+)', post_url)
                    if activity_match:
                        self.posts_cache[activity_match.group(1)] = post_data

                    if guid is not None and guid.text:
                        self.posts_cache[guid.text] = post_data

        except Exception as e:
            print(f"RSS Error: {e}")

    def clean_html(self, html_text):
        """Remove HTML tags"""
        if not html_text:
            return ""
        clean = re.sub(r'<[^>]+>', '', html_text)
        return ' '.join(clean.split())[:2000]

    def find_article_by_id(self, comment_id):
        """Find article by activity ID"""
        if not comment_id:
            return None

        activity_id = comment_id.split('-')[0] if '-' in str(comment_id) else str(comment_id)

        if activity_id in self.posts_cache:
            return self.posts_cache[activity_id]

        for key, data in self.posts_cache.items():
            if activity_id in key or key in activity_id:
                return data

        return None

    def start_processing(self, new_only=True):
        """Start processing comments"""
        if self.is_processing:
            return

        self.is_processing = True
        self.process_new_btn.configure(state='disabled')
        self.process_all_btn.configure(state='disabled')

        def process_thread():
            try:
                all_data = self.sheet.get_all_values()
                rows = all_data[1:]

                if new_only:
                    rows_to_process = [(i, row) for i, row in enumerate(rows)
                                       if len(row) <= COL_CHATGPT or not row[COL_CHATGPT] or len(row[COL_CHATGPT]) < 20]
                else:
                    rows_to_process = [(i, row) for i, row in enumerate(rows)]

                total = len(rows_to_process)

                if total == 0:
                    self.root.after(0, lambda: self.update_status("No comments to process!", 100))
                    self.root.after(0, lambda: self.update_progress_title("Complete"))
                    return

                self.root.after(0, lambda: self.update_progress_title(f"Processing {total} Comments"))

                for idx, (i, row) in enumerate(rows_to_process):
                    progress = ((idx + 1) / total) * 100

                    commenter = row[COL_PROFILE_NAME] if len(row) > COL_PROFILE_NAME else "Unknown"
                    comment_id = row[COL_ID] if len(row) > COL_ID else ""
                    comment_type = row[COL_TYPE].lower() if len(row) > COL_TYPE else ""
                    comment_text = row[COL_TEXT] if len(row) > COL_TEXT else ""
                    industry = row[COL_INDUSTRY] if len(row) > COL_INDUSTRY else ""

                    if comment_type == 'reaction' and not comment_text:
                        comment_text = "liked"

                    self.root.after(0, lambda c=commenter: self.update_info('commenter', c))
                    self.root.after(0, lambda i=industry: self.update_info('industry', i or "Not specified"))
                    self.root.after(0, lambda t=comment_text: self.update_info('comment', t))
                    self.root.after(0, lambda: self.update_status(f"Processing comment {idx+1} of {total}...", progress))

                    article = self.find_article_by_id(comment_id)
                    if article:
                        self.root.after(0, lambda a=article: self.update_info('article', a.get('title', 'Unknown')))
                    else:
                        self.root.after(0, lambda: self.update_info('article', "Not found in RSS feed"))

                    profile_data = {
                        'industry': row[COL_INDUSTRY] if len(row) > COL_INDUSTRY else "",
                        'summary': row[COL_SUMMARY] if len(row) > COL_SUMMARY else "",
                        'location': row[COL_LOCATION] if len(row) > COL_LOCATION else "",
                        'company': row[COL_COMPANY] if len(row) > COL_COMPANY else "",
                    }

                    self.root.after(0, lambda: self.update_status(f"Generating AI response...", progress))
                    response, ai_model = self.generate_ai_response(article, comment_text, commenter, comment_type, profile_data)

                    self.root.after(0, lambda m=ai_model: self.update_info('ai_model', m))
                    self.root.after(0, lambda r=response: self.update_info('response', r))

                    self.root.after(0, lambda: self.update_status(f"Updating Google Sheet...", progress))

                    try:
                        self.sheet.update(f"O{i+2}", [[response]])

                        if article:
                            self.sheet.update(f"P{i+2}", [[article.get('title', '')[:500]]])
                            self.sheet.update(f"Q{i+2}", [[article.get('description', '')[:2000]]])
                    except Exception as e:
                        print(f"Update error: {e}")

                    time.sleep(0.3)

                self.root.after(0, lambda: self.update_status(f"Complete! Processed {total} comments", 100))
                self.root.after(0, lambda: self.update_progress_title("Complete"))

            except Exception as e:
                self.root.after(0, lambda err=e: self.update_status(f"Error: {str(err)}", 0))
                self.root.after(0, lambda err=e: messagebox.showerror("Processing Error", str(err)))

            finally:
                self.is_processing = False
                self.root.after(0, lambda: self.process_new_btn.configure(state='normal'))
                self.root.after(0, lambda: self.process_all_btn.configure(state='normal'))

        threading.Thread(target=process_thread, daemon=True).start()

    def generate_ai_response(self, article_context, comment_text, commenter_name, comment_type, profile_data=None):
        """Generate AI response using cascade"""

        if article_context:
            context_text = f"""ORIGINAL ARTICLE/POST:
Title: {article_context.get('title', 'N/A')}
Content: {article_context.get('description', 'N/A')[:1500]}"""
        else:
            context_text = "ORIGINAL POST: [Article context not available]"

        profile_context = ""
        if profile_data:
            parts = []
            if profile_data.get('industry'):
                parts.append(f"Industry: {profile_data['industry']}")
            if profile_data.get('company'):
                parts.append(f"Company: {profile_data['company']}")
            if profile_data.get('location'):
                parts.append(f"Location: {profile_data['location']}")
            if profile_data.get('summary'):
                parts.append(f"Bio: {profile_data['summary'][:300]}")
            if parts:
                profile_context = f"\n\nABOUT {commenter_name.upper()}:\n" + "\n".join(parts)

        if comment_type == 'reaction':
            prompt = f"""You are JJ Shay, a business AI influencer on LinkedIn.

{context_text}{profile_context}

Someone named {commenter_name} reacted to this post with a "{comment_text or 'like'}".

Write a brief, personalized LinkedIn comment (2-3 sentences) that:
1. Thanks them for engaging
2. References something specific from the article if available
3. Asks an insightful follow-up question tailored to their industry/background if known
4. Sounds authentic and conversational

Reply only with the response text."""
        else:
            prompt = f"""You are JJ Shay, a business AI influencer on LinkedIn.

{context_text}{profile_context}

COMMENT FROM {commenter_name}:
{comment_text}

Write a brief LinkedIn reply (2-3 sentences) that:
1. Directly addresses their specific point
2. References the original article topic for context
3. Adds an insightful perspective tailored to their industry/background if known
4. Encourages further discussion
5. Sounds authentic, not corporate

Reply only with the response text."""

        # Try each AI in cascade
        if self.api_keys.get('chatgpt'):
            self.root.after(0, lambda: self.update_info('ai_model', "Trying ChatGPT..."))
            self.root.after(0, lambda: self.highlight_active_ai('chatgpt'))
            response = self.call_chatgpt(prompt)
            if response:
                return response, "ChatGPT"

        if self.api_keys.get('claude'):
            self.root.after(0, lambda: self.update_info('ai_model', "Trying Claude..."))
            self.root.after(0, lambda: self.highlight_active_ai('claude'))
            response = self.call_claude(prompt)
            if response:
                return response, "Claude"

        if self.api_keys.get('grok'):
            self.root.after(0, lambda: self.update_info('ai_model', "Trying Grok..."))
            self.root.after(0, lambda: self.highlight_active_ai('grok'))
            response = self.call_grok(prompt)
            if response:
                return response, "Grok"

        if self.api_keys.get('gemini'):
            self.root.after(0, lambda: self.update_info('ai_model', "Trying Gemini..."))
            self.root.after(0, lambda: self.highlight_active_ai('gemini'))
            response = self.call_gemini(prompt)
            if response:
                return response, "Gemini"

        if comment_type == 'reaction':
            return "Thanks for engaging! I'd love to hear your thoughts on this topic. What aspect resonated most with you?", "Template"
        else:
            return "Great point! Thanks for adding to the conversation. What's your experience been with this?", "Template"

    def call_chatgpt(self, prompt):
        try:
            response = requests.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.api_keys['chatgpt']}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": "gpt-4o-mini",
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 250,
                    "temperature": 0.7
                },
                timeout=30
            )
            if response.status_code == 200:
                return response.json()['choices'][0]['message']['content'].strip()
        except Exception as e:
            print(f"ChatGPT error: {e}")
        return None

    def call_claude(self, prompt):
        try:
            response = requests.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": self.api_keys['claude'],
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json"
                },
                json={
                    "model": "claude-3-haiku-20240307",
                    "max_tokens": 250,
                    "messages": [{"role": "user", "content": prompt}]
                },
                timeout=30
            )
            if response.status_code == 200:
                return response.json()['content'][0]['text'].strip()
        except Exception as e:
            print(f"Claude error: {e}")
        return None

    def call_grok(self, prompt):
        try:
            response = requests.post(
                "https://api.x.ai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.api_keys['grok']}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": "grok-3",
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 250,
                    "temperature": 0.7
                },
                timeout=30
            )
            if response.status_code == 200:
                return response.json()['choices'][0]['message']['content'].strip()
        except Exception as e:
            print(f"Grok error: {e}")
        return None

    def call_gemini(self, prompt):
        try:
            response = requests.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key={self.api_keys['gemini']}",
                headers={"Content-Type": "application/json"},
                json={
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {"maxOutputTokens": 250, "temperature": 0.7}
                },
                timeout=30
            )
            if response.status_code == 200:
                return response.json()['candidates'][0]['content']['parts'][0]['text'].strip()
        except Exception as e:
            print(f"Gemini error: {e}")
        return None

    def run(self):
        """Start the application"""
        self.root.mainloop()


if __name__ == "__main__":
    app = AppleStyleGUI()
    app.run()
