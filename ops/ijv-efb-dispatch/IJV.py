import streamlit as st
import json
import requests
import math
import re
import io
import os
import base64
from datetime import datetime, timedelta, timezone
from jinja2 import Environment, BaseLoader
from weasyprint import HTML

# ---------------------------------------------------------
# KONFIGURASI HALAMAN (Harus dipanggil paling awal)
# ---------------------------------------------------------
st.set_page_config(page_title="IJV EFB Dispatch", page_icon="IJV_Color.png", layout="wide", initial_sidebar_state="collapsed")

# ---------------------------------------------------------
from ofp_render import get_image_base64, dict_to_obj, render_pdf


# ---------------------------------------------------------
# SISTEM LOGIN (UI/UX CUSTOM)
# ---------------------------------------------------------
if 'logged_in' not in st.session_state:
    st.session_state['logged_in'] = False

def login_page():
    bg_base64 = get_image_base64("bg.png")
    ijv_logo_base64 = get_image_base64("IJV.png")
    
    st.markdown(f"""
    <style>
        /* 1. Paksa halaman penuh tanpa margin/padding bawaan Streamlit */
        .appview-container .main .block-container {{
            padding: 0rem !important;
            max-width: 100% !important;
            overflow: hidden !important;
        }}
        header[data-testid="stHeader"] {{ visibility: hidden !important; height: 0 !important; display: none !important; }}
        footer {{ visibility: hidden !important; display: none !important; }}
        
        /* 2. Menghilangkan Gap Antar Kolom */
        [data-testid="stHorizontalBlock"] {{
            gap: 0rem !important;
            height: 100vh !important;
            align-items: stretch !important;
        }}
        
        /* 3. KOLOM KIRI (Form Putih) - Menggunakan 2 selektor untuk semua versi Streamlit */
        [data-testid="column"]:nth-of-type(1), [data-testid="stColumn"]:nth-of-type(1) {{
            background-color: #FFFFFF !important;
            padding: 5% 4% !important;
            display: flex !important;
            flex-direction: column !important;
            justify-content: center !important;
            height: 100vh !important;
            z-index: 10;
            box-shadow: 2px 0 15px rgba(0,0,0,0.1);
        }}
        
        /* 4. KOLOM KANAN (Gambar Latar Belakang) */
        [data-testid="column"]:nth-of-type(2), [data-testid="stColumn"]:nth-of-type(2) {{
            background-image: url('data:image/png;base64,{bg_base64}') !important;
            background-size: cover !important;
            background-position: center !important;
            background-repeat: no-repeat !important;
            background-color: #02203c !important; /* Biru Dongker jika gambar lambat/gagal muat */
            height: 100vh !important;
            min-height: 100vh !important; /* Paksa minimal tinggi 100vh */
            padding: 0 !important;
        }}

        /* 5. Membersihkan Form Bawaan Streamlit */
        [data-testid="stForm"] {{
            border: none !important;
            padding: 0 !important;
            background-color: transparent !important;
        }}

        /* 6. Kotak Input Mirip Web Asli */
        .stTextInput input {{
            border: 1px solid #e0e0e0 !important;
            border-radius: 5px !important;
            padding: 0.6rem !important;
            font-size: 14px !important;
        }}
        
        /* 7. Paksa Tombol Log In Menjadi Full Width dan Biru */
        [data-testid="stFormSubmitButton"] button, .stButton button {{
            background-color: #2196F3 !important;
            color: white !important;
            border: none !important;
            border-radius: 5px !important;
            font-weight: bold !important;
            width: 100% !important;
            padding: 0.6rem !important;
            transition: background-color 0.3s;
        }}
        [data-testid="stFormSubmitButton"] button:hover, .stButton button:hover {{
            background-color: #1976D2 !important;
        }}
    </style>
    """, unsafe_allow_html=True)

    # Proporsi kolom: Kiri 1, Kanan 2.5 (Agar lebar gambar dominan seperti contoh)
    col1, col2 = st.columns([1, 2.5])
    
    with col1:
        # Spacer Atas
        st.markdown("<div style='height: 10vh;'></div>", unsafe_allow_html=True)
        
        # LOGO IJV & TULISAN CREW PORTAL
        if ijv_logo_base64:
            st.markdown(f"""
            <div style="text-align: center; margin-bottom: 2rem;">
                <img src="data:image/png;base64,{ijv_logo_base64}" style="max-width: 180px;"><br>
                <div style="font-family: Arial, sans-serif; font-size: 24px; font-weight: bold; color: #333; margin-top: 10px;">Crew Portal</div>
            </div>
            """, unsafe_allow_html=True)
        else:
            st.markdown("<h1 style='text-align: center; color: #2196F3; margin-bottom: 2rem;'>IJV Crew Portal</h1>", unsafe_allow_html=True)
        
        # FORM LOGIN
        with st.form("login_form"):
            username = st.text_input("Crew ID", placeholder="Crew ID", label_visibility="collapsed")
            password = st.text_input("Password", type="password", placeholder="Password", label_visibility="collapsed")
            submit = st.form_submit_button("Log in")
            
            if submit:
                if password == "IJV1" and username != "":
                    st.session_state['logged_in'] = True
                    st.session_state['username'] = username
                    st.rerun()
                else:
                    st.error("Crew ID atau Password tidak valid!")
        
        # Tulisan Lupa Password
        st.markdown("<div style='text-align: right; margin-top: 5px;'><a href='#' style='color: #2196F3; text-decoration: none; font-size: 13px; font-family: Arial, sans-serif;'>Forgot password?</a></div>", unsafe_allow_html=True)
        
        # Spacer Bawah
        st.markdown("<div style='height: 25vh;'></div>", unsafe_allow_html=True)
        
        # Footer Web di Kiri Bawah
        st.markdown("<div style='text-align: center; font-size: 11px; color: #888; font-family: Arial, sans-serif;'>www.indonesiajourneyvirtual.org</div>", unsafe_allow_html=True)

    with col2:
        # PENTING: Jangan gunakan st.empty(). Beri div raksasa tak terlihat agar Streamlit menarik kolomnya selebar 100vh!
        st.markdown("<div style='height: 100vh; width: 100%;'></div>", unsafe_allow_html=True)

# ---------------------------------------------------------
# DASHBOARD (GENERATOR OFP)
# ---------------------------------------------------------
def dashboard():
    # Mengembalikan padding untuk halaman Dashboard agar rapi kembali
    st.markdown("""
    <style>
        .appview-container .main .block-container { padding: 3rem 5rem !important; } 
        header[data-testid="stHeader"] { visibility: visible !important; }
    </style>
    """, unsafe_allow_html=True)
    
    st.sidebar.title(f"Welcome, {st.session_state.get('username', 'Crew')}")
    if st.sidebar.button("Logout"):
        st.session_state['logged_in'] = False
        st.rerun()

    st.title("OFP & Briefing Package Generator")
    
    # Membaca Logo untuk Template PDF (FDCGA.png)
    logo_path = "IJV.png"
    logo_base64 = get_image_base64(logo_path)

    # 1. Grab parameter from URL
    url_username = st.query_params.get("username", "")
    
    # 2. Swap field to read Username and assign the URL parameter as its default value
    sb_userid = st.text_input("Enter SimBrief Username:", value=url_username)
    
    # 3. Create the layout button
    trigger_generation = st.button("Generate OFP PDF")
    
    # 4. AUTO-RUN SWITCH: If a URL user is detected and we haven't processed them yet, force-trigger execution
    if url_username and "auto_run_executed" not in st.session_state:
        st.session_state["auto_run_executed"] = True
        trigger_generation = True

    if trigger_generation:
            
        with st.spinner(f"⏳ Mengunduh data dari SimBrief (Username: {sb_userid})..."):
            # Update 'userid=' menjadi 'username=' agar API SimBrief mencocokkan string dengan benar
            sb_url = f"https://www.simbrief.com/api/xml.fetcher.php?username={sb_userid}&json=1"
            try:
                response = requests.get(sb_url, timeout=15)
                response.raise_for_status()
                data_json = response.json()
                
                if 'fetch' in data_json and data_json['fetch']['status'] != 'Success':
                    st.error(f"⚠️ Peringatan SimBrief: {data_json['fetch']['status']}")
                    return
            except Exception as e:
                st.error(f"❌ Gagal mengunduh data: {e}")
                return

        with st.spinner("⚙️ Generating..."):
            try:
                data_obj = dict_to_obj(data_json)
                pdf_buffer = io.BytesIO(render_pdf(data_json))
                
                st.success("✅ OFP Generated and Ready for Download")
                
                # --- BERIKUT EDITAN UNTUK DIRECT PDF PREVIEW ---
                # Safely extract values with fallback strings if fields are missing or None
                airline_icao = getattr(getattr(data_obj, 'general', {}), 'icao_airline', '') or 'FLIGHT'
                flight_num = getattr(getattr(data_obj, 'general', {}), 'flight_number', '') or 'PLAN'
                
                # Sanitize values to remove any trailing/leading spaces or unintended characters
                airline_icao = str(airline_icao).strip()
                flight_num = str(flight_num).strip()

                # Generate the safe final string name
                pdf_filename = f"{airline_icao}{flight_num}_Briefing.pdf"
                st.download_button(
                    label="📥 Download OFP PDF",
                    data=pdf_buffer.getvalue(),
                    file_name=pdf_filename,
                    mime="application/pdf",
                    type="primary",
                    on_click="ignore"  # no rerun on click, otherwise the preview below would disappear
                )
                
                # Inline preview (needs streamlit[pdf] in requirements.txt); the download button above works even if this fails
                try:
                    st.pdf(pdf_buffer.getvalue(), height=800)
                except Exception as e:
                    st.warning(f"PDF preview unavailable: {e}")
                
            except Exception as e:
                st.error(f"❌ Terjadi kesalahan saat memproses data/PDF: {e}")

# ---------------------------------------------------------
# ROUTING APLIKASI & INTERNET URL PAYLOADS DARI PHP
# ---------------------------------------------------------
# Cek parameter URL '?username=...' dari Web PHP utama
# ---------------------------------------------------------
# ROUTING APLIKASI (UPDATED FOR INSTANT PHP REDIRECT)
# ---------------------------------------------------------
# '?username=' only prefills the SimBrief field after login (dashboard reads it); it is never proof of sign-in
if st.session_state['logged_in']:
    dashboard()
else:
    login_page()
