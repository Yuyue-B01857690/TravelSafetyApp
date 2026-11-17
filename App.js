import React, { useState, useEffect, useRef } from 'react';
import {
View,
Text,
StyleSheet,
ScrollView,
TouchableOpacity,
SafeAreaView,
StatusBar,
Alert,
TextInput,
Linking,
} from 'react-native';

import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import * as SMS from 'expo-sms';
import NetInfo from '@react-native-community/netinfo';

const STORAGE_KEY = '@travel_safety_locations';
const PENDING_QUEUE_KEY = '@travel_safety_pending_uploads';
const SMS_RECIPIENT_KEY = '@travel_safety_sms_recipient';

// Replace this with your real backend endpoint when your server is ready.
const API_URL = 'http://10.26.4.138:3000/api/locations';

const TRACKING_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const RETRY_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes

export default function App() {
const [activeTab, setActiveTab] = useState('Home');

const [location, setLocation] = useState(null);
const [loadingLocation, setLoadingLocation] = useState(false);

const [records, setRecords] = useState([]);
const [loadingRecords, setLoadingRecords] = useState(true);

const [note, setNote] = useState('');

// Automatic tracking and delivery status
const [isTracking, setIsTracking] = useState(false);
const [deliveryStatus, setDeliveryStatus] = useState('Not started');
const [smsRecipient, setSmsRecipient] = useState('');
const [smsRecipientLoaded, setSmsRecipientLoaded] = useState(false);

const retryTimerRef = useRef(null);
const pendingPayloadRef = useRef(null);
const uploadInProgressRef = useRef(false);

// ✅ 保存SMS号码到本地存储
const saveSmsRecipient = async (number) => {
  try {
    await AsyncStorage.setItem(SMS_RECIPIENT_KEY, number);
    setSmsRecipient(number);
  } catch (err) {
    console.log('Failed to save sms recipient', err);
    Alert.alert('Storage Error','Cannot save SMS recipient number');
  }
};

// ✅ 加载保存好的SMS号码
const loadSmsRecipient = async () => {
  try {
    const savedNumber = await AsyncStorage.getItem(SMS_RECIPIENT_KEY);
    if(savedNumber !== null){
      setSmsRecipient(savedNumber);
    }
  } catch (err) {
    console.log('Failed to load sms recipient', err);
  } finally {
    setSmsRecipientLoaded(true);
  }
};

// Load saved records and retry pending uploads when the app opens
useEffect(() => {
loadRecords();
loadSmsRecipient(); // 加载保存的紧急号码

const unsubscribe = NetInfo.addEventListener((state) => {
if (state.isConnected && state.isInternetReachable !== false) {
flushPendingUploads();
}
});

return () => {
unsubscribe();

if (retryTimerRef.current) {
clearTimeout(retryTimerRef.current);
}
};
}, []);

const loadRecords = async () => {
try {
const savedData = await AsyncStorage.getItem(STORAGE_KEY);

if (savedData !== null) {
setRecords(JSON.parse(savedData));
}
} catch (error) {
Alert.alert('Storage Error', 'Unable to load saved records.');
} finally {
setLoadingRecords(false);
}
};

// Save records permanently in local storage
const saveRecords = async (updatedRecords) => {
try {
await AsyncStorage.setItem(
STORAGE_KEY,
JSON.stringify(updatedRecords)
);

setRecords(updatedRecords);
return true;
} catch (error) {
Alert.alert('Storage Error', 'Unable to save your records.');
return false;
}
};

// Get the real GPS location
const getCurrentLocation = async () => {
try {
setLoadingLocation(true);

const { status } =
await Location.requestForegroundPermissionsAsync();

if (status !== 'granted') {
Alert.alert(
'Permission Denied',
'Please allow location access in your iPhone Settings.'
);
return;
}

const currentLocation =
await Location.getCurrentPositionAsync({
accuracy: Location.Accuracy.High,
});

setLocation(currentLocation);

Alert.alert(
'GPS Successful',
`Latitude: ${currentLocation.coords.latitude.toFixed(6)}\n` +
`Longitude: ${currentLocation.coords.longitude.toFixed(6)}`
);

} catch (error) {
Alert.alert(
'GPS Error',
error.message || 'Unable to retrieve location.'
);
} finally {
setLoadingLocation(false);
}
};

// Send one location record to the backend using HTTP POST.
const sendLocationToServer = async (payload) => {
if (API_URL.includes('YOUR_SERVER_URL')) {
throw new Error(
'Please configure API_URL with your backend address.'
);
}

const response = await fetch(API_URL, {
method: 'POST',
headers: {
'Content-Type': 'application/json',
},
body: JSON.stringify(payload),
});

if (!response.ok) {
throw new Error(`Server returned status ${response.status}.`);
}

return true;
};

// Read pending uploads from local storage
const readPendingQueue = async () => {
try {
const savedQueue = await AsyncStorage.getItem(PENDING_QUEUE_KEY);
return savedQueue ? JSON.parse(savedQueue) : [];
} catch (error) {
console.log('Unable to read pending queue:', error);
return [];
}
};

// Save pending uploads permanently
const savePendingQueue = async (queue) => {
try {
await AsyncStorage.setItem(
PENDING_QUEUE_KEY,
JSON.stringify(queue)
);
return true;
} catch (error) {
console.log('Unable to save pending queue:', error);
return false;
}
};

// Retry every 3 minutes, whether tracking is ON or OFF
const scheduleRetry = () => {
if (retryTimerRef.current) {
clearTimeout(retryTimerRef.current);
}

retryTimerRef.current = setTimeout(async () => {
retryTimerRef.current = null;
await flushPendingUploads();
}, RETRY_INTERVAL_MS);
};

// Upload all pending locations
const flushPendingUploads = async () => {
if (uploadInProgressRef.current) return;

const queue = await readPendingQueue();

if (queue.length === 0) {
if (retryTimerRef.current) {
clearTimeout(retryTimerRef.current);
retryTimerRef.current = null;
}
return;
}

uploadInProgressRef.current = true;
let remainingQueue = [...queue];

try {
for (const item of queue) {
try {
setDeliveryStatus('Sending saved location to server...');

await sendLocationToServer(item.payload);

// Remove successfully uploaded item from queue
remainingQueue = remainingQueue.filter(
(queuedItem) => queuedItem.recordId !== item.recordId
);

await savePendingQueue(remainingQueue);

// Update its History record as synchronised
const savedData = await AsyncStorage.getItem(STORAGE_KEY);
const currentRecords = savedData
? JSON.parse(savedData)
: [];

const updatedRecords = currentRecords.map((record) =>
record.id === item.recordId
? { ...record, syncStatus: 'synced' }
: record
);

await saveRecords(updatedRecords);

setDeliveryStatus('Location sent to server successfully');

} catch (uploadError) {
console.log('Pending upload failed:', uploadError);

// Keep the original SMS backup behaviour
try {
await sendSMSBackup(item.payload);
} catch (smsError) {
console.log('SMS backup error:', smsError);
}

// Keep failed records for the next retry
break;
}
}
} finally {
uploadInProgressRef.current = false;
}

const latestQueue = await readPendingQueue();

if (latestQueue.length > 0) {
setDeliveryStatus('Waiting for network - will retry in 3 minutes');
scheduleRetry();
} else if (retryTimerRef.current) {
clearTimeout(retryTimerRef.current);
retryTimerRef.current = null;
}
};

// SMS fallback: on iPhone, Expo opens the Messages composer.
// The user must review and tap Send; Expo Go cannot silently send SMS.
const sendSMSBackup = async (payload) => {
if (!smsRecipient.trim()) {
setDeliveryStatus('SMS backup needs a recipient number');
return false;
}

const available = await SMS.isAvailableAsync();

if (!available) {
setDeliveryStatus('SMS is not available on this device');
return false;
}

const message =
`Travel Safety Location\n` +
`Latitude: ${payload.latitude}\n` +
`Longitude: ${payload.longitude}\n` +
`Time: ${payload.timestamp}`;

await SMS.sendSMSAsync([smsRecipient.trim()], message);

setDeliveryStatus(
'SMS composer opened - tap Send on your iPhone'
);

return true;
};

// Capture GPS, save locally first, then upload to server
const captureAndSendLocation = async (showPermissionAlert = true) => {
setLoadingLocation(true);

try {
// Check foreground location permission
const { status } =
await Location.requestForegroundPermissionsAsync();

if (status !== 'granted') {
setLocation(null);
setDeliveryStatus('Location permission denied');

// Show a clear permission reminder
if (showPermissionAlert) {
Alert.alert(
'Location Permission Required',
'Travel Safety Tracker needs access to your location to record and share your GPS position. Please enable location permission in your iPhone Settings.',
[
{
text: 'Cancel',
style: 'cancel',
},
{
text: 'Open Settings',
onPress: () => {
Linking.openSettings();
},
},
]
);
}

return;
}

// Get current GPS location
const currentLocation =
await Location.getCurrentPositionAsync({
accuracy: Location.Accuracy.High,
});

setLocation(currentLocation);

Alert.alert(
'GPS Successful',
`Latitude: ${currentLocation.coords.latitude.toFixed(6)}\n` +
`Longitude: ${currentLocation.coords.longitude.toFixed(6)}`
);

const recordId = Date.now().toString();

const timestamp = new Date(
currentLocation.timestamp
).toISOString();

const payload = {
latitude: currentLocation.coords.latitude,
longitude: currentLocation.coords.longitude,
accuracy: currentLocation.coords.accuracy,
timestamp,
};

// Create local History record
const localRecord = {
id: recordId,
latitude: payload.latitude,
longitude: payload.longitude,
accuracy: payload.accuracy,
timestamp,
note: 'Automatic GPS location',
syncStatus: 'pending',
};

// Save to History before uploading
const savedData = await AsyncStorage.getItem(STORAGE_KEY);

const currentRecords = savedData
? JSON.parse(savedData)
: [];

const updatedRecords = [
localRecord,
...currentRecords,
];

const localSaveSucceeded = await saveRecords(updatedRecords);

if (!localSaveSucceeded) {
setDeliveryStatus('GPS captured, but local saving failed');
return;
}

// Add location to persistent upload queue
const existingQueue = await readPendingQueue();

const updatedQueue = [
...existingQueue,
{
recordId,
payload,
},
];

const queueSaved = await savePendingQueue(updatedQueue);

if (!queueSaved) {
setDeliveryStatus(
'Location saved locally, but upload queue could not be saved'
);
return;
}

pendingPayloadRef.current = payload;

setDeliveryStatus(
'Location saved locally - uploading to server...'
);

// Upload immediately
await flushPendingUploads();

} catch (error) {
console.log('Automatic tracking error:', error);

setDeliveryStatus(
error.message || 'Unable to capture/send location'
);

} finally {
setLoadingLocation(false);
}
};

// Run a new GPS + delivery cycle every 30 minutes while the app is open.
useEffect(() => {
if (!isTracking) return undefined;

// Automatic tracking does not repeatedly show permission alerts
captureAndSendLocation(false);

const intervalId = setInterval(() => {
captureAndSendLocation(false);
}, TRACKING_INTERVAL_MS);

return () => clearInterval(intervalId);
}, [isTracking]);

// Clean up retry timer when the app screen is unmounted.
useEffect(() => {
return () => {
if (retryTimerRef.current) {
clearTimeout(retryTimerRef.current);
}
};
}, []);

const toggleAutomaticTracking = () => {
if (isTracking) {
setIsTracking(false);

if (retryTimerRef.current) {
clearTimeout(retryTimerRef.current);
retryTimerRef.current = null;
}

setDeliveryStatus('Tracking stopped');

Alert.alert(
'Tracking Stopped',
'Automatic location tracking has stopped.'
);
} else {
setIsTracking(true);

setDeliveryStatus('Starting location tracking...');

Alert.alert(
'Tracking Started',
'The app will capture and attempt to send your location now, then every 30 minutes while the app remains open.'
);
}
};

// CREATE: Save the current GPS location
const addRecord = async () => {
if (!location) {
Alert.alert(
'No GPS Location',
'Please get your current location first.'
);
return;
}

const newRecord = {
id: Date.now().toString(),
latitude: location.coords.latitude,
longitude: location.coords.longitude,
accuracy: location.coords.accuracy,
timestamp: new Date(location.timestamp).toISOString(),
note: note.trim() || 'Travel location',
};

const updatedRecords = [newRecord, ...records];

const success = await saveRecords(updatedRecords);

if (success) {
setNote('');

Alert.alert(
'Success',
'Location record saved successfully.'
);

setActiveTab('History');
}
};

// UPDATE: Edit an existing record's note
const updateRecord = (id, oldNote) => {
Alert.prompt(
'Edit Location Note',
'Enter a new description:',
async (newNote) => {
if (newNote === undefined || !newNote.trim()) {
return;
}

const updatedRecords = records.map((record) =>
record.id === id
? { ...record, note: newNote.trim() }
: record
);

const success = await saveRecords(updatedRecords);

if (success) {
Alert.alert(
'Updated',
'Your location record was updated.'
);
}
},
'plain-text',
oldNote
);
};

// DELETE: Remove a saved record
const deleteRecord = (id) => {
Alert.alert(
'Delete Record',
'Are you sure you want to delete this location record?',
[
{ text: 'Cancel', style: 'cancel' },
{
text: 'Delete',
style: 'destructive',
onPress: async () => {
const updatedRecords = records.filter(
(record) => record.id !== id
);

const success = await saveRecords(updatedRecords);

if (success) {
const queue = await readPendingQueue();

const updatedQueue = queue.filter(
(item) => item.recordId !== id
);

await savePendingQueue(updatedQueue);

Alert.alert(
'Deleted',
'Location record removed.'
);
}
},
},
]
);
};

// HOME PAGE
const renderHome = () => (
<ScrollView showsVerticalScrollIndicator={false}>
<View style={styles.welcomeSection}>
<Text style={styles.greeting}>
TRAVEL SAFETY TRACKER
</Text>

<Text style={styles.heading}>Stay Safe,</Text>

<Text style={styles.headingGreen}>
Wherever You Go.
</Text>

<Text style={styles.subtitle}>
Your personal travel safety companion.
</Text>
</View>

<View style={styles.statusCard}>
<Text style={styles.cardLabel}>
LOCATION TRACKING
</Text>

<Text style={styles.statusTitle}>
{location ? 'Location Retrieved' : 'Ready to Track'}
</Text>

<Text style={styles.statusDescription}>
Get your current GPS location and save your travel history.
</Text>

<TouchableOpacity
style={styles.primaryButton}
onPress={captureAndSendLocation}
disabled={loadingLocation}
>

<Text style={styles.primaryButtonText}>
{loadingLocation
? 'Getting Location...'
: '◎  Get My Current Location'}
</Text>
</TouchableOpacity>
</View>

<View style={styles.infoCard}>
<Text style={styles.infoTitle}>
Automatic Safety Tracking
</Text>

<Text style={styles.infoDescription}>
Location interval: every 30 minutes. If HTTP delivery fails,
the app retries every 3 minutes and offers SMS backup.
</Text>

<Text style={styles.trackingStatus}>
Status: {isTracking ? 'Tracking is ON' : 'Tracking is OFF'}
</Text>

<Text style={styles.infoDescription}>
Delivery: {deliveryStatus}
</Text>

<TouchableOpacity
style={[
styles.primaryButton,
isTracking && styles.stopTrackingButton,
]}
onPress={toggleAutomaticTracking}
>

<Text style={styles.primaryButtonText}>
{isTracking
? 'Stop Automatic Tracking'
: 'Start Automatic Tracking'}
</Text>
</TouchableOpacity>
</View>

<Text style={styles.sectionTitle}>
Current Location
</Text>

<View style={styles.infoCard}>
<View style={styles.infoContent}>
<Text style={styles.infoTitle}>
GPS Coordinates
</Text>

{location ? (
<>
<Text style={styles.infoDescription}>
Latitude: {location.coords.latitude.toFixed(6)}
</Text>

<Text style={styles.infoDescription}>
Longitude: {location.coords.longitude.toFixed(6)}
</Text>

<Text style={styles.infoDescription}>
Accuracy: {location.coords.accuracy == null
? 'Unavailable'
: `${location.coords.accuracy.toFixed(1)} metres`}
</Text>

<Text style={styles.infoDescription}>
Time: {new Date(location.timestamp).toLocaleString()}
</Text>
</>
) : (
<Text style={styles.infoDescription}>
No location retrieved yet.
</Text>
)}
</View>
</View>

{location && (
<View style={styles.saveCard}>
<Text style={styles.sectionTitle}>
Save This Location
</Text>

<TextInput
style={styles.input}
placeholder="Add a travel note (optional)"
placeholderTextColor="#8993A8"
value={note}
onChangeText={setNote}
/>

<TouchableOpacity
style={styles.primaryButton}
onPress={addRecord}
>

<Text style={styles.primaryButtonText}>
+ Save Location Record
</Text>
</TouchableOpacity>
</View>
)}

<View style={styles.statsContainer}>
<View style={styles.statCard}>
<Text style={styles.statNumber}>
{records.length}
</Text>

<Text style={styles.statLabel}>
Saved Records
</Text>
</View>

<View style={styles.statCard}>
<Text style={styles.statNumber}>
{location ? 'Active' : 'Waiting'}
</Text>

<Text style={styles.statLabel}>
GPS Status
</Text>
</View>
</View>
</ScrollView>
);

// HISTORY PAGE
const renderHistory = () => (
<ScrollView showsVerticalScrollIndicator={false}>
<View style={styles.pageHeader}>
<Text style={styles.heading}>
Location History
</Text>

<Text style={styles.subtitle}>
View and manage your saved GPS records.
</Text>
</View>

<View style={styles.historySummary}>
<Text style={styles.cardLabelWhite}>
TOTAL RECORDS
</Text>

<Text style={styles.historyNumber}>
{records.length}
</Text>

<Text style={styles.historyDescription}>
Your saved travel locations.
</Text>
</View>

{loadingRecords ? (
<Text style={styles.emptyDescription}>
Loading records...
</Text>
) : records.length === 0 ? (
<View style={styles.emptyCard}>
<Text style={{ fontSize: 45 }}>🗺️</Text>

<Text style={styles.emptyTitle}>
No Location Records
</Text>

<Text style={styles.emptyDescription}>
Get your GPS location and save your first record.
</Text>

<TouchableOpacity
style={styles.primaryButton}
onPress={() => setActiveTab('Home')}
>

<Text style={styles.primaryButtonText}>
Go to Home
</Text>
</TouchableOpacity>
</View>
) : (
records.map((record) => (
<View key={record.id} style={styles.recordCard}>
<View style={styles.recordHeader}>
<Text style={styles.recordTitle}>
📍 {record.note}
</Text>

<Text style={styles.recordBadge}>
Saved
</Text>
</View>

<Text style={styles.infoDescription}>
Latitude: {record.latitude.toFixed(6)}
</Text>

<Text style={styles.infoDescription}>
Longitude: {record.longitude.toFixed(6)}
</Text>

<Text style={styles.infoDescription}>
Accuracy: {record.accuracy == null
? 'Unavailable'
: `${record.accuracy.toFixed(1)} metres`}
</Text>

<Text style={styles.infoDescription}>
Date: {new Date(record.timestamp).toLocaleString()}
</Text>

<View style={styles.actionRow}>
<TouchableOpacity
style={styles.editButton}
onPress={() =>
updateRecord(record.id, record.note)
}
>
<Text style={styles.editButtonText}>
Edit
</Text>
</TouchableOpacity>

<TouchableOpacity
style={styles.deleteButton}
onPress={() => deleteRecord(record.id)}
>

<Text style={styles.deleteButtonText}>
Delete
</Text>
</TouchableOpacity>
</View>
</View>
))
)}
</ScrollView>
);

// SETTINGS PAGE
const renderSettings = () => (
<ScrollView showsVerticalScrollIndicator={false}>
<View style={styles.pageHeader}>
<Text style={styles.heading}>Settings</Text>

<Text style={styles.subtitle}>
Manage your safety tracking preferences.
</Text>
</View>

<Text style={styles.sectionTitle}>
App Information
</Text>

<View style={styles.infoCard}>
<Text style={styles.infoTitle}>
Local Storage
</Text>

<Text style={styles.infoDescription}>
AsyncStorage is used to save your location records locally.
</Text>
</View>

<View style={styles.infoCard}>
<Text style={styles.infoTitle}>
Saved Records
</Text>

<Text style={styles.infoDescription}>
{records.length} location records stored.
</Text>
</View>

<View style={styles.infoCard}>
<Text style={styles.infoTitle}>
GPS Service
</Text>

<Text style={styles.infoDescription}>
Expo Location API
</Text>
</View>

<View style={styles.infoCard}>
<Text style={styles.infoTitle}>
SMS Backup Recipient
</Text>

<Text style={styles.infoDescription}>
Enter the phone number or SMS gateway number used for backup.
</Text>

<TextInput
style={styles.input}
placeholder="e.g. +441234567890"
placeholderTextColor="#8993A8"
value={smsRecipient}
onChangeText={(val)=>saveSmsRecipient(val)}
keyboardType="phone-pad"
/>

<Text style={styles.infoDescription}>
On iPhone, the Messages screen will open and you must tap Send.
This is not silent automatic SMS delivery.
</Text>
</View>

<View style={styles.aboutCard}>
<Text style={styles.infoTitle}>
Travel Safety Tracker
</Text>

<Text style={styles.infoDescription}>
Version 1.0.0
</Text>
</View>
</ScrollView>
);

return (
<SafeAreaView style={styles.container}>
<StatusBar
barStyle="dark-content"
backgroundColor="#F5FAF7"
/>

<View style={styles.topBar}>
<View style={styles.logoBox}>
<Text style={styles.logoText}>T</Text>
</View>

<View style={styles.topBarText}>
<Text style={styles.appName}>
Travel Safety
</Text>

<Text style={styles.appSubtitle}>
YOUR SAFETY COMPANION
</Text>
</View>

<Text style={{ fontSize: 25 }}>🛡️</Text>
</View>

<LinearGradient
colors={['#DDF7E8', '#DDEBFA', '#E9E1F7']}
start={{ x: 0, y: 0 }}
end={{ x: 1, y: 1 }}
style={styles.content}
>

{activeTab === 'Home' && renderHome()}
{activeTab === 'History' && renderHistory()}
{activeTab === 'Settings' && renderSettings()}
</LinearGradient>

<View style={styles.bottomNav}>
{[
{ name: 'Home', icon: '⌂' },
{ name: 'History', icon: '◷' },
{ name: 'Settings', icon: '⚙' },
].map((tab) => (
<TouchableOpacity
key={tab.name}
style={styles.navItem}
onPress={() => setActiveTab(tab.name)}
>
<Text
style={[
styles.navIcon,
activeTab === tab.name && styles.activeNavIcon,
]}
>
{tab.icon}
</Text>

<Text
style={[
styles.navLabel,
activeTab === tab.name && styles.activeNavLabel,
]}
>
{tab.name}
</Text>
</TouchableOpacity>
))}
</View>
</SafeAreaView>
);
}

const styles = StyleSheet.create({
container: {
flex: 1,
backgroundColor: '#F5FAF7',
},

topBar: {
height: 72,
flexDirection: 'row',
alignItems: 'center',
paddingHorizontal: 20,
backgroundColor: '#FFFFFF',
},

logoBox: {
width: 43,
height: 43,
backgroundColor: '#19C878',
borderRadius: 13,
alignItems: 'center',
justifyContent: 'center',
},

logoText: {
color: '#FFFFFF',
fontSize: 23,
fontWeight: 'bold',
},

topBarText: {
marginLeft: 11,
flex: 1,
},

appName: {
fontSize: 17,
fontWeight: 'bold',
color: '#1D2B48',
},

appSubtitle: {
fontSize: 9,
color: '#8993A8',
letterSpacing: 1.2,
marginTop: 3,
},

content: {
flex: 1,
paddingHorizontal: 20,
paddingTop: 18,
},

welcomeSection: {
marginBottom: 20,
},

greeting: {
fontSize: 10,
color: '#19A968',
fontWeight: 'bold',
letterSpacing: 1.5,
marginBottom: 9,
},

heading: {
fontSize: 27,
fontWeight: 'bold',
color: '#1D2B48',
},

headingGreen: {
fontSize: 27,
fontWeight: 'bold',
color: '#19C878',
},

subtitle: {
color: '#8993A8',
fontSize: 13,
marginTop: 8,
lineHeight: 20,
},

statusCard: {
backgroundColor: '#FFFFFF',
borderRadius: 19,
padding: 19,
marginBottom: 23,
borderWidth: 1,
borderColor: '#DCEFE4',
},

cardLabel: {
fontSize: 10,
fontWeight: 'bold',
color: '#8993A8',
letterSpacing: 1,
},

statusTitle: {
fontSize: 19,
fontWeight: 'bold',
color: '#1D2B48',
marginTop: 8,
},

statusDescription: {
color: '#8993A8',
fontSize: 12,
marginTop: 15,
marginBottom: 17,
},

trackingStatus: {
color: '#159B61',
fontSize: 12,
fontWeight: 'bold',
marginTop: 12,
},

stopTrackingButton: {
backgroundColor: '#E56B78',
},

primaryButton: {
minHeight: 49,
borderRadius: 12,
backgroundColor: '#19C878',
justifyContent: 'center',
alignItems: 'center',
paddingHorizontal: 12,
marginTop: 12,
},

primaryButtonText: {
color: '#FFFFFF',
fontSize: 14,
fontWeight: 'bold',
},

sectionTitle: {
fontSize: 17,
fontWeight: 'bold',
color: '#1D2B48',
marginBottom: 13,
},

infoCard: {
backgroundColor: '#FFFFFF',
borderRadius: 15,
padding: 16,
marginBottom: 15,
borderWidth: 1,
borderColor: '#E8ECF5',
},

infoContent: {
flex: 1,
},

infoTitle: {
fontSize: 14,
color: '#1D2B48',
fontWeight: 'bold',
},

infoDescription: {
color: '#8993A8',
fontSize: 11,
marginTop: 6,
lineHeight: 17,
},

saveCard: {
backgroundColor: '#FFFFFF',
borderRadius: 15,
padding: 16,
marginBottom: 18,
borderWidth: 1,
borderColor: '#DCEFE4',
},

input: {
backgroundColor: '#F5FAF7',
borderWidth: 1,
borderColor: '#DCEFE4',
borderRadius: 10,
padding: 13,
color: '#1D2B48',
fontSize: 13,
},

statsContainer: {
flexDirection: 'row',
gap: 12,
marginBottom: 20,
},

statCard: {
flex: 1,
backgroundColor: '#FFFFFF',
borderRadius: 15,
padding: 16,
borderWidth: 1,
borderColor: '#E8ECF5',
},

statNumber: {
color: '#19C878',
fontSize: 22,
fontWeight: 'bold',
},

statLabel: {
color: '#8993A8',
fontSize: 11,
marginTop: 5,
},

pageHeader: {
marginBottom: 25,
},

historySummary: {
backgroundColor: '#3B82F6',
borderRadius: 18,
padding: 22,
marginBottom: 20,
},

cardLabelWhite: {
color: '#FFFFFF',
fontSize: 10,
fontWeight: 'bold',
letterSpacing: 1,
},

historyNumber: {
color: '#FFFFFF',
fontSize: 38,
fontWeight: 'bold',
marginTop: 10,
},

historyDescription: {
color: '#FFFFFF',
fontSize: 12,
marginTop: 5,
},

emptyCard: {
backgroundColor: '#FFFFFF',
borderRadius: 18,
padding: 25,
alignItems: 'center',
borderWidth: 1,
borderColor: '#E8ECF5',
},

emptyTitle: {
color: '#1D2B48',
fontWeight: 'bold',
fontSize: 17,
marginTop: 15,
},

emptyDescription: {
color: '#8993A8',
textAlign: 'center',
fontSize: 12,
lineHeight: 20,
marginTop: 9,
},

recordCard: {
backgroundColor: '#FFFFFF',
borderRadius: 15,
padding: 16,
marginBottom: 14,
borderWidth: 1,
borderColor: '#DCEFE4',
},

recordHeader: {
flexDirection: 'row',
justifyContent: 'space-between',
alignItems: 'center',
marginBottom: 10,
},

recordTitle: {
color: '#1D2B48',
fontSize: 14,
fontWeight: 'bold',
flex: 1,
},

recordBadge: {
color: '#159B61',
backgroundColor: '#E9F8F0',
padding: 6,
borderRadius: 7,
fontSize: 10,
},

actionRow: {
flexDirection: 'row',
gap: 10,
marginTop: 14,
},

editButton: {
flex: 1,
backgroundColor: '#EAF2FF',
padding: 11,
borderRadius: 9,
alignItems: 'center',
},

editButtonText: {
color: '#3B82F6',
fontWeight: 'bold',
},

deleteButton: {
flex: 1,
backgroundColor: '#FFF0F0',
padding: 11,
borderRadius: 9,
alignItems: 'center',
},

deleteButtonText: {
color: '#D94B4B',
fontWeight: 'bold',
},

aboutCard: {
backgroundColor: '#FFFFFF',
padding: 18,
borderRadius: 15,
marginTop: 12,
},

bottomNav: {
height: 67,
backgroundColor: '#FFFFFF',
borderTopWidth: 1,
borderTopColor: '#E8ECF5',
flexDirection: 'row',
justifyContent: 'space-around',
alignItems: 'center',
},

navItem: {
flex: 1,
alignItems: 'center',
justifyContent: 'center',
},

navIcon: {
fontSize: 22,
color: '#AAB2C2',
},

activeNavIcon: {
color: '#19C878',
},

navLabel: {
color: '#AAB2C2',
fontSize: 10,
marginTop: 4,
},

activeNavLabel: { color: '#19C878', fontWeight: 'bold', }, });
