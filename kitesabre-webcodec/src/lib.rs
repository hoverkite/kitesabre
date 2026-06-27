use kitesabre_messages::{Command, Report};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum DecodeEvent {
    Report { report: Report },
    Text { text: String },
    DecodeError { error: String },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct DecodeResult {
    events: Vec<DecodeEvent>,
    leftover_text: String,
    leftover_binary: Vec<u8>,
    in_binary_frame: bool,
}

fn js_error(message: impl Into<String>) -> JsValue {
    JsValue::from_str(&message.into())
}

fn encode_command_bytes(command: Command) -> Result<Vec<u8>, String> {
    let encoded = command
        .to_vec()
        .map_err(|e| format!("failed to encode command: {e}"))?;

    let mut framed = Vec::with_capacity(encoded.len() + 1);
    framed.push(b'#');
    framed.extend_from_slice(&encoded);
    Ok(framed)
}

fn flush_text_if_any(events: &mut Vec<DecodeEvent>, text_buffer: &mut Vec<u8>) {
    if text_buffer.is_empty() {
        return;
    }

    let text = String::from_utf8_lossy(text_buffer).to_string();
    events.push(DecodeEvent::Text { text });
    text_buffer.clear();
}

#[wasm_bindgen]
pub fn encode_command(command_json: JsValue) -> Result<Vec<u8>, JsValue> {
    let command: Command = serde_wasm_bindgen::from_value(command_json)
        .map_err(|e| js_error(format!("invalid command json: {e}")))?;
    encode_command_bytes(command).map_err(js_error)
}

#[wasm_bindgen]
pub struct StreamDecoder {
    text_buffer: Vec<u8>,
    binary_buffer: Vec<u8>,
    in_binary_frame: bool,
    expect_newline_after_binary: bool,
}

impl Default for StreamDecoder {
    fn default() -> Self {
        Self {
            text_buffer: Vec::new(),
            binary_buffer: Vec::new(),
            in_binary_frame: false,
            expect_newline_after_binary: false,
        }
    }
}

impl StreamDecoder {
    fn decode_chunk(&mut self, chunk: &[u8]) -> DecodeResult {
        let mut events = Vec::new();

        for &byte in chunk {
            if self.in_binary_frame {
                if byte == 0 {
                    let mut frame = core::mem::take(&mut self.binary_buffer);
                    match Report::from_slice(&mut frame) {
                        Ok(report) => events.push(DecodeEvent::Report { report }),
                        Err(e) => events.push(DecodeEvent::DecodeError {
                            error: format!("failed to decode report: {e}"),
                        }),
                    }
                    self.in_binary_frame = false;
                    self.expect_newline_after_binary = true;
                    continue;
                }

                self.binary_buffer.push(byte);
                continue;
            }

            if self.expect_newline_after_binary {
                self.expect_newline_after_binary = false;
                if byte == b'\n' {
                    continue;
                }
            }

            match byte {
                b'#' => {
                    flush_text_if_any(&mut events, &mut self.text_buffer);
                    self.in_binary_frame = true;
                    self.binary_buffer.clear();
                }
                b'\n' => flush_text_if_any(&mut events, &mut self.text_buffer),
                _ => self.text_buffer.push(byte),
            }
        }

        DecodeResult {
            events,
            leftover_text: String::from_utf8_lossy(&self.text_buffer).to_string(),
            leftover_binary: self.binary_buffer.clone(),
            in_binary_frame: self.in_binary_frame,
        }
    }
}

#[wasm_bindgen]
impl StreamDecoder {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn decode_stream(&mut self, chunk: &[u8]) -> Result<JsValue, JsValue> {
        let result = self.decode_chunk(chunk);
        serde_wasm_bindgen::to_value(&result)
            .map_err(|e| js_error(format!("failed to serialize decode result: {e}")))
    }

    pub fn reset(&mut self) {
        *self = Self::default();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use kitesabre_messages::Time;

    fn frame_report(report: &Report) -> Vec<u8> {
        let encoded = report.to_vec().expect("report should encode");
        let mut framed = Vec::new();
        framed.push(b'#');
        framed.extend_from_slice(&encoded);
        framed.push(b'\n');
        framed
    }

    #[test]
    fn encode_command_wraps_with_binary_prefix() {
        let command = Command::SetPositions {
            left: 0.25,
            right: -0.5,
        };
        let encoded = encode_command_bytes(command).expect("encode command");

        assert_eq!(encoded[0], b'#');

        let mut payload = encoded[1..].to_vec();
        let decoded = Command::from_slice(&mut payload).expect("decode command");
        assert_eq!(decoded, command);
    }

    #[test]
    fn decode_stream_tracks_leftovers_and_reports() {
        let report = Report::Time(Time { time: 42 });
        let framed = frame_report(&report);

        let mut decoder = StreamDecoder::new();

        let first_half = decoder.decode_chunk(&framed[..3]);
        assert!(first_half.events.is_empty());
        assert!(first_half.in_binary_frame);
        assert!(!first_half.leftover_binary.is_empty());

        let second_half = decoder.decode_chunk(&framed[3..]);
        assert_eq!(second_half.events.len(), 1);
        assert!(second_half.leftover_binary.is_empty());
        assert!(!second_half.in_binary_frame);

        match &second_half.events[0] {
            DecodeEvent::Report { report: decoded } => assert_eq!(decoded, &report),
            other => panic!("expected report event, got {other:?}"),
        }
    }

    #[test]
    fn decode_stream_emits_text_lines() {
        let mut decoder = StreamDecoder::new();
        let result = decoder.decode_chunk(b"hello world\n");

        assert_eq!(
            result.events,
            vec![DecodeEvent::Text {
                text: "hello world".to_string()
            }]
        );
    }
}
